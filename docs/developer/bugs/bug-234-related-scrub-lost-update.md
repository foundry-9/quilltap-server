# Bug 234 — Two deletes in one job can leave a deleted id in a shared neighbour's related links

| | |
|---|---|
| **Status** | Open — closed by Phase B of the [memory system refactor](../features/memory-system-refactor.md) (`retireMemories`), or sooner with a removal delta |
| **Found** | 2026-10-12, fixing review finding #2 on PR 90 |
| **Fixed** | — |
| **Severity** | Low — a dangling id in `relatedMemoryIds`; readers skip ids with no row, so the cost is a wasted lookup and a wrong link count |
| **Who it bites** | background jobs that delete two memories sharing a neighbour (regenerate, housekeeping, retention, dedup) |
| **Provenance** | Original to v4. The `consolidatedFrom` half of the same pattern was fixed in PR 90 (review finding #2) with a removal delta |
| **Defect site** | `lib/memory/memory-gate.ts` `deleteMemoryWithUnlink` (neighbour scan via `rawQuery`, ~`:995`) and `deleteMemoriesWithUnlinkBatch` (~`:1091`): both read neighbours from the committed snapshot and write each neighbour's whole `relatedMemoryIds` list back |
| **Fix site** | — |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../bugs.md) |

---

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
