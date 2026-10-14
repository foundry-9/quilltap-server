# Bug 217 — The dispatcher's vector-store invalidation keys some writes on the wrong id and misses bulk deletes

| | |
|---|---|
| **Status** | Fixed 2026-10-12 (targeted fix ahead of Phase B) |
| **Found** | 2026-10-12, code audit for the memory system refactor (appendix B) |
| **Fixed** | 2026-10-12 |
| **Severity** | Low — latent today: the incidental `vectorIndices.saveMeta` write covers the cases that occur, so no stale store has been observed; any future child write that skips `save()` would leave the parent's in-process vector store stale until restart |
| **Who it bites** | nobody yet; any background job that deletes memories or rewrites embeddings without going through `CharacterVectorStore.save()` |
| **Provenance** | Original to v4. Came in with the forked job child's post-commit invalidation (`dispatchInvalidations`) |
| **Defect site** | `lib/background-jobs/host/job-dispatcher.ts:762-773` (`WRITES_INVALIDATING_VECTOR_STORE`), `:714` (key lookup); `lib/realtime/job-topics.ts:154` (`firstIdArg`) |
| **Fix site** | `lib/background-jobs/host/vector-store-invalidation.ts` (new); `lib/background-jobs/host/job-dispatcher.ts` (`applyWritesUnsafe`, `dispatchInvalidations`) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** `WRITES_INVALIDATING_VECTOR_STORE` and its `firstIdArg` probe are gone. `vector-store-invalidation.ts` states each write method's argument shape once (`VECTOR_STORE_WRITE_SHAPES`: characterId first argument, `characterId` field, array of entries, or memory id(s)) and `vectorStoreKeysForWrites` turns a batch into the set of touched characterIds. `memories.bulkDelete`, `memories.deleteForCharacter`, `vectorIndices.addEntries` and the other per-character vector writes are now covered. Memory-id-keyed writes (`memories.delete`, `memories.update`, `vectorIndices.updateEntryEmbedding`, `removeEntry`, `removeEntries`) are resolved to their owner by `lookupMemoryOwners` in `applyWritesUnsafe` *before* the batch commits (one `SELECT id, characterId` over `memories` and `vector_entries`), since a deleted row cannot be read afterwards. `dispatchInvalidations` then unloads (and notifies the child for) each touched character. Making `characterId` the first argument of every `MemoriesRepository` write stays with Phase B. Tests: `lib/background-jobs/host/__tests__/job-dispatcher-vector-invalidation.test.ts`. Per the owner's review of PR 90, `memories.incrementReinforcement` is deliberately *not* in the table: it changes neither a vector nor a tier, the store caches nothing derived from reinforcement, and listing it unloaded the character's store after nearly every turn.

## Symptom

After a background job's write batch commits, `dispatchInvalidations` is supposed to unload the
parent's (and child's) cached `CharacterVectorStore` for every character whose memories or vectors
changed. For some write methods it unloads nothing.

## Root cause

`dispatchInvalidations` (`job-dispatcher.ts:697`) reads a key with
`firstIdArg(w.args, 'characterId')` (`:714`) and unloads that key if the method is in
`WRITES_INVALIDATING_VECTOR_STORE` (`:762-773`). `firstIdArg` (`job-topics.ts:154`) returns the
first positional argument when it is a string, otherwise the `characterId` field of an object
first argument. Stores are keyed by character id. Against the list:

- `memories.delete(id)` (`memories.repository.ts:613`) takes a **memory** id, so the unload targets
  a store that does not exist — a no-op.
- `vectorIndices.updateEntryEmbedding(id, embedding)` (`vector-indices.repository.ts:258`) also
  takes a memory id — the same no-op.
- `memories.bulkDelete(characterId, ids)` (`memories.repository.ts:657`), the write the child
  actually issues for deletions (`deleteMemoriesWithUnlinkBatch`, `memory-gate.ts:908`), is not
  in the list.
- `vectorIndices.addEntries` / `removeEntries` are not in the list, and their first argument is an
  array, so `firstIdArg` would yield nothing for them even if they were.

What keeps this latent: `CharacterVectorStore.save()` (`lib/embedding/vector-store.ts:170-213`)
writes `vectorIndices.saveMeta(characterId, …)` whenever it has changes, and `saveMeta` is in the
list with a correct key. Every child path that deletes or re-embeds today also calls `save()`.
`memories.delete` itself is called only from `deleteMemoryWithUnlink` (`memory-gate.ts:798`),
whose callers are parent-side routes.

Note: appendix B.4 of the spec lists `memories.delete` as unused. It is not; it is the
single-row delete inside `deleteMemoryWithUnlink`.

## Why it survived

The `saveMeta` write masks every gap, so no test or walkthrough ever saw a stale store. The list
is maintained by hand next to an id-probing helper whose contract (first string argument) does not
match half of the methods in it.

## Fix

Phase B (spec §3.5): `WRITES_INVALIDATING_VECTOR_STORE` and the `firstIdArg` probe for vectors go.
The child repositories proxy records the characterId of every `memories.*` write — `characterId`
becomes the stated first argument of every write method on `MemoriesRepository`, with a test — and
the commit hook calls `memoryIndex.reload(characterId)` for each touched character.
`vector_entries` is retired, so the `vectorIndices.*` entries disappear with it.

## Verify

Extend `job-dispatcher-frozen-archive.test.ts` (or a sibling): a child batch containing only
`memories.bulkDelete(charA, [...])` reloads charA's store; a batch touching charA and charB
reloads both; a batch with no `memories.*` write reloads none.
