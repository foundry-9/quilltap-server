# Bug 205 — Rebuilding a character's vector index marks cold memories hot

| | |
|---|---|
| **Status** | Fixed 2026-10-12 (targeted fix ahead of Phase B) |
| **Found** | 2026-10-12, code audit for the memory system refactor (appendix B) |
| **Fixed** | 2026-10-12 |
| **Severity** | Medium — archived (cold) memories, including members a digest has replaced, come back into hot-only recall alongside their digest until the store is next reloaded |
| **Who it bites** | anyone who calls `PUT /api/v1/memories?action=embeddings` for a character with cold rows; no screen in the app calls this action today, so in practice API and script users |
| **Provenance** | Original to v4. `rebuildVectorIndex` predates tiers; the gap opened when consolidation and hot/cold tiers (`d585480`, 2026-10-08) made tier ride on in-memory vector metadata stamped only by `load()` |
| **Defect site** | `lib/memory/memory-service.ts:1588-1630` (`rebuildVectorIndex`; `addVector` with no tier at `:1616-1619`); line numbers at `4a38222` |
| **Fix site** | `lib/memory/memory-service.ts` (`rebuildVectorIndex`; also `generateMissingEmbeddings` and `updateMemoryWithEmbedding`) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** `rebuildVectorIndex` now passes `tier: memory.tier === 'cold' ? 'cold' : 'hot'` in each `addVector` call, so the rebuilt (and cached) store marks cold rows cold and `isHotVector` filters them. The same tier stamp was added to the two other `addVector` sites in `memory-service.ts` that can add an existing (possibly cold) row: `generateMissingEmbeddings` and the add branch of `updateMemoryWithEmbedding`. Persisting tier with the vector (`memories.embedding` + `memories.tier` as the only copy) stays with Phase B. Tests: `rebuildVectorIndex` case in `__tests__/unit/lib/memory/memory-service.test.ts`.

## Symptom

After a rebuild, the character's per-turn recall surfaces memories that housekeeping demoted or
consolidation superseded. A digest and the members it replaced can both appear in one whisper.
The effect lasts until the character's store is unloaded (a job that writes that character's
memories, an embedding-generate job for one of its rows, or a process restart) and reloaded.

## Root cause

Tier is not persisted in `vector_entries`; it lives only in the in-memory entry's metadata
(`lib/embedding/vector-store.ts:29-34`). `CharacterVectorStore.load()` stamps it from
`findColdIdsByCharacterId` (`:112-131`). Recall's hot-only filter is `isHotVector`, which treats a
missing tier as hot (`:89-91`).

`rebuildVectorIndex` (`memory-service.ts:1588`) calls `manager.deleteStore` (`:1598`), then
`manager.getStore` (`:1601`), whose `load()` finds no entries because they were just deleted. It
then adds every row with an embedding — `findByCharacterId` returns both tiers — through
`addVector(memory.id, memory.embedding!, { memoryId, characterId })` (`:1616-1619`), with no
`tier`. The rebuilt store is cached by the manager (`vector-store.ts:559-569`), so every cold row
passes `isHotVector` until the store is unloaded.

The only caller is `handleRebuildIndex` (`app/api/v1/memories/route.ts:1201-1220` at `4a38222`),
reached by `PUT ?action=embeddings` (`:264-266`).

## Why it survived

The rebuild action has no button in the app, and the leak ends on the next unload, which any memory
write for that character triggers. A test of the rebuild would check entry counts, not tiers.

## Fix

Phase B makes `memories.embedding` + `memories.tier` the only copy: the in-process store loads
`SELECT id, embedding, tier FROM memories WHERE characterId = ?`, so the tier always rides with the
vector and there is no separate stamping step for a rebuild to skip. `rebuildVectorIndex` becomes
`memoryIndex.reload(characterId)`.

## Verify

Pick a character with cold rows. Call the rebuild action, then run a per-turn recall (or
`recall-replay`) on a query that matches a cold member of a digest: the cold row is not returned
and the digest is. Restart and repeat; same result.
