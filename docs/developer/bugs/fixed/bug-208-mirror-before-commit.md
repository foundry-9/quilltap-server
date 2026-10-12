# Bug 208 — Consolidation writes the Commonplace mirror before its digests are committed

| | |
|---|---|
| **Status** | Fixed 2026-10-12 (targeted fix ahead of Phase F) |
| **Found** | 2026-10-12, code audit for the memory system refactor (appendix D) |
| **Fixed** | 2026-10-12 |
| **Severity** | Medium — when a consolidation job's batch fails to commit, the vault's `Commonplace/*.md` files describe digests that were never saved, and the extractor reads those files back as canon |
| **Who it bites** | characters whose background consolidation job fails after planning (a write-batch failure in the parent, or a throw after the mirror call); the job is not retried (`maxAttempts: 1`), so the wrong file stands until a later run rewrites that bucket |
| **Provenance** | Original to v4. Came in with consolidation and hot/cold tiers (`d585480`, 2026-10-08), which added the Commonplace mirror (`commonplace-digest-vault-bridge.ts`) |
| **Defect site** | `lib/memory/consolidation.ts:1031-1041` (announce, mirror call at `:1040`), `:643-700` (`mirrorTouchedBuckets`); `lib/file-storage/commonplace-digest-vault-bridge.ts:68-74` (child short-circuit to host-RPC); `lib/background-jobs/host/host-rpc-dispatcher.ts:117-122` |
| **Fix site** | `lib/memory/commonplace-mirror.ts` (new: `mirrorCommonplaceAfterCommit`, `mirrorCommonplaceForSubjects`, `subjectsTouchedByWrites`); `lib/background-jobs/host/job-dispatcher.ts` (post-commit hook); `lib/memory/consolidation.ts` (mirror deferred in the child); `lib/file-storage/commonplace-digest-vault-bridge.ts` (refuses in the child); `host-rpc-dispatcher.ts` / `ipc-types.ts` (RPC method removed) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** The Commonplace mirror is now written only from committed rows. `runConsolidation` no longer writes the vault from the job child: it logs that the mirror is deferred and returns. The parent's `handleChildJobResult` (`job-dispatcher.ts`) calls `mirrorCommonplaceAfterCommit` after `applyWritesAtomically` succeeds and the job is marked COMPLETED; it derives the touched holder/subject buckets from the committed batch (`memories.create` with `source: 'CONSOLIDATED'`, and digest revisions — `updateForCharacter` patches carrying `consolidatedFrom` — read back from the committed row) and rebuilds each bucket's file from `findHotDigests`. A batch that fails to commit, or a job that failed in the child, never reaches the hook. In-process runs (parent) mirror after their writes land, through the same `mirrorCommonplaceForSubjects`. The `writeCommonplaceDigestsToVault` host-RPC method is removed, and the bridge refuses (`skippedReason: 'job-child'`) if called in the child. Tests: `lib/background-jobs/host/__tests__/job-dispatcher-commonplace-mirror.test.ts` (failed commit → FAILED, no mirror; committed → mirror after commit; child failure → no mirror), `lib/memory/__tests__/commonplace-mirror.test.ts`, `lib/memory/__tests__/consolidation-service.test.ts` (child defers), `lib/file-storage/__tests__/commonplace-digest-vault-bridge.test.ts` (child refusal). Review follow-up (2026-10-12): deleting a digest also refreshes its bucket's mirror. In the parent the delete chokepoints call `mirrorCommonplaceForSubjects` after the delete; for a child batch (any job type) `applyWritesUnsafe` resolves the deleted digests' buckets before commit (`digestBucketsDeletedByWrites`) and mirrors them after (`mirrorCommonplaceForDeletedDigests`). A bucket left with no hot digest has its file removed by the bridge rather than left stale. Character deletion (`cascade-delete.ts`) deletes the character's digests while the row still exists, so each subject is re-mirrored and its emptied `Commonplace/` file removed before the vault is unlinked or retired; archived characters are skipped by the bridge. Confirmed as intended by the owner, 2026-10-12.

## Symptom

A consolidation job plans and embeds three new digests for a character, the vault mirror
`Commonplace/Laura.md` is rewritten to include them, and then the job's write batch fails in the
parent. The `memories` table has no such digests and the members were never moved to cold, but the
vault file lists them. The next extraction for that holder and subject loads the file as canon and
treats the phantom digests as established fact.

## Root cause

In the job child every repository write is buffered and shipped to the parent when the handler
returns; the parent commits it (`lib/background-jobs/host/job-dispatcher.ts`, `applyWritesUnsafe`
at `:365`), and a partition failure marks the job FAILED (`:357-361`).

`runConsolidation` runs `executePlan` (`consolidation.ts:1033`), which in the child only buffers
the creates, tier moves and link rewrites. It then calls `mirrorTouchedBuckets` (`:1040`), which
calls `writeCommonplaceDigestsToVault` (`:691`). In the child that function does not buffer; it
calls the parent immediately over host-RPC (`commonplace-digest-vault-bridge.ts:72-74`), and the
parent writes the vault documents at once (`host-rpc-dispatcher.ts:117-122`). The vault write
therefore lands before the batch that justifies it, and nothing undoes it if the batch fails.

The comment above the announce block (`consolidation.ts:1035-1037`) notes that the other two
effects in it, `invalidateFrozenArchive` and `publishRealtime`, are no-ops in the child and are
redone by the dispatcher after commit. The mirror is the one effect in that block that is not a
no-op in the child.

## Why it survived

The host-RPC route was the fix for a different problem: the child cannot model the server-assigned
ids that `writeDatabaseDocument` produces. Batch failures are rare, the job is not retried, and the
mirror is described as a convenience the next run rewrites, so a stale file was not considered.
That description misses that `cheap-llm-tasks/canon.ts` reads the file as canon.

## Fix

Phase F moves every effect of a maintenance run after commit. The child returns its report; the
parent's post-commit hook in `job-dispatcher.ts` reloads the index, invalidates frozen archives,
publishes `memories`, and writes the Commonplace mirror for the touched buckets from the committed
rows. A failed batch leaves no vault write. The `writeCommonplaceDigestsToVault` host-RPC call
from consolidation goes away.

## Verify

Run consolidation as a job on a character with a consolidatable cluster, with a test flag that
makes the parent's batch apply throw. The job is FAILED, no digest rows exist, and the
character's `Commonplace/` files are unchanged (same content and modification time as before the
run). Without the flag, the files update only after the batch commits.
