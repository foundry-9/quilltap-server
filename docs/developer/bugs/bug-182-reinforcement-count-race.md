# Bug 182 — concurrent reinforcements of one memory can lose a count

| | |
|---|---|
| **Status** | **Open** |
| **Found** | 2026-10-08, Copilot review of PR 83 (memory-recall-and-housekeeping-fixes, F1) |
| **Fixed** | — |
| **Severity** | **Low.** One lost observation per collision: `reinforcementCount` ends one short and `reinforcedImportance` a hair low. No text, vector or link damage |
| **Who it bites** | characters whose memory extraction runs more than one job at a time (a raised `MEMORY_EXTRACTION` concurrency cap, or several chats feeding one character) when two jobs restate the same fact in the same moment |
| **Provenance** | v4 review finding; not from the v5 port |
| **Defect site** | `absorbNearDuplicate` (`lib/memory/memory-gate.ts:412-420`) and `reinforceMemory` (`:450-522`) compute `newCount = (existingMemory.reinforcementCount ?? 1) + 1` from the gate's snapshot of the row and persist it as an absolute value through `patchMemory` → `MemoriesRepository.updateForCharacter` |
| **Fix site** | not chosen — see "Fix" |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../bugs.md) |

---

## Symptom

Two extraction jobs that both match the same existing memory (a near-duplicate under F1, or a
`REINFORCE`) each read `reinforcementCount = N`, each write `N + 1`, and the row ends at `N + 1`
instead of `N + 2`. `reinforcedImportance` is recomputed from the same stale `N`, so it is low by
one step of `log2(count + 1) * 0.05`. Nothing reports it.

## Root cause

The reinforcement write is read-then-absolute-write. The count comes from the `Memory` the gate
fetched (`runMemoryGate` → `repos.memories.findByIds`), not from the row at write time, and
`updateForCharacter` stores whatever value it is handed. In the job child the read is from the
readonly snapshot and the write is buffered until the parent commits the batch, which widens the
window to the length of a whole job.

## Why it survived

The `REINFORCE` path has always had this shape. Before F1 the `≥ 0.90` band wrote nothing at all,
so the most common restatements never raced; F1 made them write, which is what brought the race
into review. A lost count needs two concurrent jobs on one character matching one row, and its
only effect is a slightly lower protection/ranking score.

## Fix

Not done in PR 83 by decision of the owner (2026-10-08). Options:

- An atomic repository method — `UPDATE memories SET reinforcementCount = reinforcementCount + 1,
  lastReinforcedAt = ?, reinforcedImportance = … WHERE id = ? AND characterId = ?` — with
  `reinforcedImportance` recomputed in SQL. That needs `log2`, which depends on SQLite's math
  functions being compiled into the SQLCipher build (unverified), or a second statement that
  reads the committed count back inside the same transaction. The child proxy needs the method
  classified as a write, and its buffered payload must carry "increment", not a value.
- A compare-and-set on the old count, retried on a miss.

## Verify

A test that runs two `absorbNearDuplicate` calls against one row through the child proxy, applies
both buffered batches in the parent, and expects `reinforcementCount` to rise by two.
