# Bug 234 — Two deletes in one job can leave a deleted id in a shared neighbour's related links

| | |
|---|---|
| **Status** | Fixed 2026-10-12 (targeted fix ahead of Phase B of the [memory system refactor](../../features/complete/memory-system-refactor.md), whose `retireMemories` remains the structural work) |
| **Found** | 2026-10-12, fixing review finding #2 on PR 90 |
| **Fixed** | 2026-10-12 |
| **Severity** | Low — a dangling id in `relatedMemoryIds`; readers skip ids with no row, so the cost is a wasted lookup and a wrong link count |
| **Who it bites** | background jobs that delete two memories sharing a neighbour (regenerate, housekeeping, retention, dedup) |
| **Provenance** | Original to v4. The `consolidatedFrom` half of the same pattern was fixed in PR 90 (review finding #2) with a removal delta |
| **Defect site** | `lib/memory/memory-gate.ts` `deleteMemoryWithUnlink` (neighbour scan via `rawQuery`, ~`:995`) and `deleteMemoriesWithUnlinkBatch` (~`:1091`): both read neighbours from the committed snapshot and write each neighbour's whole `relatedMemoryIds` list back |
| **Fix site** | `lib/database/repositories/memories.repository.ts` (new `removeRelatedMemoryIdsEverywhere`), `lib/memory/memory-gate.ts` (`deleteMemoryWithUnlink`, `deleteMemoriesWithUnlinkBatchReport`), `lib/background-jobs/child/child-repositories-proxy.ts` (job-wide scrub in the overlay) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** Both delete chokepoints scrub `relatedMemoryIds` with one SQL removal

**Memory refactor Phase C (2026-10-13).** The bug 234 block is in `child-proxy-memory-overlay.test.ts` (renamed from `child-proxy-memory-gate-overlay.test.ts`).
delta per holder, `MemoriesRepository.removeRelatedMemoryIdsForCharacter(characterId, ids)`, which
removes the ids from every row of that character that names them, against the rows as they stand at
write time. There is no neighbour read and no whole-list write, so two deletes in one job (or two
jobs) each remove their own id and the replay applies both. The scrub is scoped to the deleted rows'
holders (the instance-wide batch scan is gone), and the `currentLinks` option the dedup merge used
to protect its survivor's fresh list is no longer needed: the delta lands after the survivor's own
write. In the job child the overlay applies a buffered character-wide scrub to every memory row a
later read returns. The digest created and member-deleted in the same job (the "smaller relative")
is unchanged. Tests: the bug 234 block in `child-proxy-memory-gate-overlay.test.ts`,
`memories-link-deltas.test.ts`, and the rewritten `retire-memories-unlink.test.ts`.

**Amended (2026-10-13, review of PR 91).** The first fix scoped the scrub to the deleted rows'
holders and, in the batch, to the ids still found as rows. That lost two cases the old instance-wide
scan covered: an id whose row was already gone stayed in its neighbours' lists, and a link that
crosses characters (an import, a restore, legacy data) was never scrubbed. The method is now
`removeRelatedMemoryIdsEverywhere(ids)`: one instance-wide removal delta per chunk, over every
requested id, still applied against the rows at write time. The child overlay's scrub set is
job-wide rather than per character.

## Symptom

Memory N links to A and B. One background job deletes A, then B. After the parent replays the
batch, N still lists A.

## Root cause

In the job child the neighbour scan reads through `rawQuery`, which the per-job memory overlay does
not cover. The first delete buffers N's list without A; the second reads the committed list (with A)
and buffers it without B. The replay keeps the last write. The batch path's neighbour scan is also
instance-wide, without the per-character scoping finding #12 added for the digest scan.

A smaller relative: a digest created and then member-deleted in the same job is not scrubbed,
because the digest scan sees overlay patches but not the job's own creates.

## Why it survived

Same as bug 209: the delete tests run in one process, where reads see writes.

## Fix

Express the scrub as a removal delta applied in SQL at commit, as
`MemoriesRepository.removeConsolidatedMembers` now does for digests, and scope the scan by
character. Phase B's `retireMemories` is the structural fix.

## Verify

Child-proxy test: two deletes sharing a neighbour in one job; after replay the neighbour lists
neither.
