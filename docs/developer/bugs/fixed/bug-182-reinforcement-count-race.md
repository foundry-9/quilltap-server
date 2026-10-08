# Bug 182 — concurrent reinforcements of one memory can lose a count

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-10-08)** |
| **Found** | 2026-10-08, Copilot review of PR 83 (memory-recall-and-housekeeping-fixes, F1) |
| **Fixed** | 2026-10-08, v4.10-dev |
| **Severity** | **Low.** One lost observation per collision: `reinforcementCount` ends one short and `reinforcedImportance` a hair low. No text, vector or link damage |
| **Who it bites** | characters whose memory extraction runs more than one job at a time (a raised `MEMORY_EXTRACTION` concurrency cap, or several chats feeding one character) when two jobs restate the same fact in the same moment |
| **Provenance** | v4 review finding; not from the v5 port |
| **Defect site** | `absorbNearDuplicate` (`lib/memory/memory-gate.ts:412-420`) and `reinforceMemory` (`:450-522`) compute `newCount = (existingMemory.reinforcementCount ?? 1) + 1` from the gate's snapshot of the row and persist it as an absolute value through `patchMemory` → `MemoriesRepository.updateForCharacter` |
| **Fix site** | new `MemoriesRepository.incrementReinforcement` (`lib/database/repositories/memories.repository.ts`) + `countReinforcement` in `lib/memory/memory-gate.ts`, called by `absorbNearDuplicate` and `reinforceMemory`; the formula moved to `lib/memory/reinforced-importance.ts` |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-08).** The first option below. `MemoriesRepository.incrementReinforcement(characterId,
memoryId, at)` reads the row's `importance` and `reinforcementCount` and writes the incremented count,
the recomputed `reinforcedImportance` and `lastReinforcedAt` in one synchronous better-sqlite3
transaction on the main connection, so no other write interleaves and the count is always taken from
the row at write time. The importance is computed in JS from the committed count, so SQLite's math
functions are not needed. Its `increment*` prefix already classifies it as a write in the child
proxy; the buffered payload is `(characterId, memoryId, at)` — an increment, not a value — and the
parent replays it against the committed row. Both gate paths now count through `countReinforcement`
(`memory-gate.ts`); `reinforceMemory` patches only `content` and the episodic anchors through
`patchMemory`, never the three reinforcement fields. In the child the caller's local view is the
snapshot's count plus one, as before.

Not in scope: two concurrent `REINFORCE`s that both append `[+]` footnotes still compute content
from the same snapshot, and the later patch wins. That loses prose, not a count, and needs two jobs
adding *different* novel details to one row in the same moment.

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

`__tests__/unit/lib/background-jobs/child-proxy-memory-housekeeping.test.ts` ("bug 182") does this:
two job scopes absorb the same count-2 snapshot, the buffered batches are replayed against a real
SQLite row, and the row ends at 4 with `reinforcedImportance` recomputed for 4. The original plan:

A test that runs two `absorbNearDuplicate` calls against one row through the child proxy, applies
both buffered batches in the parent, and expects `reinforcementCount` to rise by two.
