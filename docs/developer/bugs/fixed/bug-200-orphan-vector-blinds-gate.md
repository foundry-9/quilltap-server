# Bug 200 — Deleting a memory leaves its vector, and an orphan vector blinds the gate

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-10-12)** |
| **Found** | 2026-10-12, code audit for the [memory system refactor](../../features/complete/memory-system-refactor.md) (appendix B) |
| **Fixed** | 2026-10-12, v4.10-dev (Phase 0 of the refactor) |
| **Severity** | High. After a deleted memory, a new candidate whose nearest neighbour was the deleted row was inserted as new, even with a live near-duplicate right behind it. Duplicates accumulated silently |
| **Who it bites** | anyone who deletes a single memory in the Commonplace Book, and any character whose vector index otherwise drifted from its rows |
| **Provenance** | Original to v4. `vector_entries` has no foreign key to `memories`; the item route went through the unlink chokepoint (`deleteMemoryWithUnlink`) and not `deleteMemoryWithVector` |
| **Defect site** | `app/api/v1/memories/[id]/route.ts` (DELETE, was line 132); `lib/memory/memory-gate.ts` (`runMemoryGateInner`, best match taken from the raw vector top-K, was lines 309-325) |
| **Fix site** | `lib/memory/memory-gate.ts` (`deleteMemoryWithUnlink` / `deleteMemoriesWithUnlinkBatch` remove vectors; `runMemoryGateInner` decides on live rows and searches past orphans) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** There are two halves:

**Memory refactor Phase C (2026-10-13).** The live-row search moved with admission to `gatherNeighbours` (`lib/memory/admission/neighbours.ts`); `memory-gate.ts` is gone. The orphan tests now live in `lib/memory/__tests__/admission-neighbours.test.ts`.

1. **Vector removal is part of the delete chokepoint.** `deleteMemoryWithUnlink` and
   `deleteMemoriesWithUnlinkBatch` remove the deleted rows' vectors themselves (best-effort, logged),
   so no caller that deletes through them can leave an orphan. The item route, restore's delete
   service and every cascade inherit it; the per-caller removal loops in `memory-service.ts`,
   housekeeping and the dedup tool are gone. `deleteMemoriesWithUnlinkBatchReport` returns the
   vector count for the cascades that report it.
2. **The gate decides on live rows only.** Vector hits with no row behind them are dropped before the
   best match is chosen and logged at `warn`. When orphans crowd the top K, the gate searches wider
   (up to 4 × K) until it has K live rows or the store runs out. It does not prune orphans itself: in
   the job child a row inserted earlier in the same job is invisible to the snapshot (bug 209) and
   would look like one.

The first version of this fix patched the item route alone and filtered orphans after a fixed top-K
search; review of PR 87 moved both into the chokepoint and the gate. Tests:
`__tests__/unit/lib/memory/memory-gate-orphan-vectors.test.ts`,
`__tests__/unit/lib/memory/retire-memories-unlink.test.ts`.

**The character-archive half of the filing does not reproduce.** `pruneArchivedCharacterState`
(`lib/characters/archive-service.ts:743`) deletes the memories, then calls
`getVectorStoreManager().deleteStore(characterId)`, which drops the character's whole index. A
character's index holds only its own memories, so nothing is orphaned. If that step fails, the prune
reports itself incomplete and a re-run finishes it.

## Symptom

Delete a memory in the Commonplace Book. Later, the character re-observes the same fact, a live row
already holds it, and the gate inserts it as new instead of reinforcing that row.

## Root cause

The item DELETE called `deleteMemoryWithUnlink(memoryId)`, which removes the row and scrubs
`relatedMemoryIds`, but not the vector. `vector_entries` has no FK, so the vector stayed in the
character's index. In the gate, `results[0]` was the orphan, `memoryMap.get(...)` returned
`undefined`, and every branch guarded on `bestMemory` was skipped: the date guard, near-duplicate and
reinforce. The related band then excluded scores ≥ `MERGE_THRESHOLD`, so a live second match at
≥ 0.85 was ignored and the candidate fell through to `INSERT`.

## Why it survived

No test deleted a row and then gated a candidate. Duplicates are a quiet failure.

## Fix

As above. Phase B of the refactor gives the index an owner (`memoryIndex`) and drops `vector_entries`,
so after that a row and its vector cannot drift apart. Until then the chokepoint removes vectors and
the gate tolerates whatever drift is already there.

## Verify

Delete a memory, then have the character restate a fact held by a different, very similar memory. The
gate log shows `Ignored 1 orphan vector(s)` if one existed, and the decision is `REINFORCE` or
`SKIP_NEAR_DUPLICATE`, not `INSERT`.
