# Bug 208 — Consolidation writes the Commonplace mirror before its digests are committed

| | |
|---|---|
| **Status** | Open — closed by Phase F of the [memory system refactor](../features/memory-system-refactor.md) |
| **Found** | 2026-10-12, code audit for the memory system refactor (appendix D) |
| **Fixed** | — |
| **Severity** | Medium — when a consolidation job's batch fails to commit, the vault's `Commonplace/*.md` files describe digests that were never saved, and the extractor reads those files back as canon |
| **Who it bites** | characters whose background consolidation job fails after planning (a write-batch failure in the parent, or a throw after the mirror call); the job is not retried (`maxAttempts: 1`), so the wrong file stands until a later run rewrites that bucket |
| **Provenance** | Original to v4. Came in with consolidation and hot/cold tiers (`d585480`, 2026-10-08), which added the Commonplace mirror (`commonplace-digest-vault-bridge.ts`) |
| **Defect site** | `lib/memory/consolidation.ts:1031-1041` (announce, mirror call at `:1040`), `:643-700` (`mirrorTouchedBuckets`); `lib/file-storage/commonplace-digest-vault-bridge.ts:68-74` (child short-circuit to host-RPC); `lib/background-jobs/host/host-rpc-dispatcher.ts:117-122` |
| **Fix site** | Phase F of the refactor — `maintenance/` (`mirror` phase, applied by the parent's post-commit hook in `job-dispatcher.ts`) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../bugs.md) |

---

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
