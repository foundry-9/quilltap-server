/**
 * Which characters' in-process vector stores a committed write batch made
 * stale (bug 217).
 *
 * Stores are keyed by character id, but the repository writes that change a
 * store do not all name the character the same way: some take it as the first
 * positional argument, some on an object payload, some as an array of entry
 * payloads, and a few take only a memory id. The old hand-kept set paired every
 * method with one id-probing helper (`firstIdArg`), which keyed `memories.delete`
 * and `vectorIndices.updateEntryEmbedding` on the *memory* id (a no-op unload)
 * and omitted `memories.bulkDelete` — the write the child actually issues for
 * deletions — and the batched `vectorIndices.*` entry writes altogether.
 *
 * Here each method states its argument shape once. Memory-id-keyed writes are
 * resolved to their owners by the caller *before* the batch commits, because a
 * deleted row cannot be looked up afterwards.
 *
 * @module background-jobs/host/vector-store-invalidation
 */

import type { ChildWritePayload } from '../ipc-types';

/** How a write method names the character(s) whose store it touches. */
type CharacterKeyShape =
  /** `method(characterId, ...)` */
  | 'characterArg'
  /** `method({ characterId, ... }, ...)` */
  | 'characterField'
  /** `method([{ characterId, ... }, ...])` */
  | 'characterFieldArray'
  /** `method(memoryId, ...)` — owner resolved before commit */
  | 'memoryIdArg'
  /** `method([memoryId, ...])` — owners resolved before commit */
  | 'memoryIdArrayArg';

/**
 * Every repository write that changes a character's memory rows or vectors in
 * a way the cached store must see (vector added/removed/changed, row
 * removed, tier moved).
 *
 * `memories.incrementReinforcement` is deliberately absent: it moves only
 * `reinforcementCount` / `reinforcedImportance` / `lastReinforcedAt`, none of
 * which the store caches (its entries carry memoryId, characterId and tier),
 * and listing it unloaded the character's store after nearly every turn.
 */
export const VECTOR_STORE_WRITE_SHAPES: Readonly<Record<string, CharacterKeyShape>> = {
  'memories.create': 'characterField',
  'memories.upsert': 'characterField',
  'memories.updateForCharacter': 'characterArg',
  'memories.deleteForCharacter': 'characterArg',
  'memories.bulkDelete': 'characterArg',
  // Tier moves change the store's hot-only metadata (stamped at load).
  'memories.updateTierBulk': 'characterArg',
  'memories.update': 'memoryIdArg',
  'memories.delete': 'memoryIdArg',
  'vectorIndices.saveMeta': 'characterArg',
  'vectorIndices.deleteStore': 'characterArg',
  'vectorIndices.deleteByCharacterId': 'characterArg',
  'vectorIndices.deleteMetaByCharacterId': 'characterArg',
  'vectorIndices.removeEntriesByCharacterId': 'characterArg',
  'vectorIndices.addEntry': 'characterField',
  'vectorIndices.addEntries': 'characterFieldArray',
  'vectorIndices.updateEntryEmbedding': 'memoryIdArg',
  'vectorIndices.removeEntry': 'memoryIdArg',
  'vectorIndices.removeEntries': 'memoryIdArrayArg',
};

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function characterFieldOf(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const id = (value as Record<string, unknown>).characterId;
  return nonEmptyString(id) ? id : undefined;
}

/**
 * The memory ids a batch's memory-id-keyed writes name, so the caller can
 * resolve their owners while the rows still exist (before commit).
 */
export function memoryIdsNeedingOwnerLookup(writes: readonly ChildWritePayload[]): string[] {
  const ids = new Set<string>();
  for (const w of writes) {
    const shape = VECTOR_STORE_WRITE_SHAPES[w.method];
    const first = w.args?.[0];
    if (shape === 'memoryIdArg' && nonEmptyString(first)) {
      ids.add(first);
    } else if (shape === 'memoryIdArrayArg' && Array.isArray(first)) {
      for (const id of first) if (nonEmptyString(id)) ids.add(id);
    }
  }
  return Array.from(ids);
}

/**
 * Character ids whose vector store the batch made stale. `memoryOwners` maps a
 * memory id to its character (resolved before commit); an id missing from it
 * contributes nothing.
 */
export function vectorStoreKeysForWrites(
  writes: readonly ChildWritePayload[],
  memoryOwners: ReadonlyMap<string, string> = new Map(),
): Set<string> {
  const keys = new Set<string>();
  for (const w of writes) {
    const shape = VECTOR_STORE_WRITE_SHAPES[w.method];
    if (!shape) continue;
    const first = w.args?.[0];
    switch (shape) {
      case 'characterArg':
        if (nonEmptyString(first)) keys.add(first);
        break;
      case 'characterField': {
        const id = characterFieldOf(first);
        if (id) keys.add(id);
        break;
      }
      case 'characterFieldArray':
        if (Array.isArray(first)) {
          for (const entry of first) {
            const id = characterFieldOf(entry);
            if (id) keys.add(id);
          }
        }
        break;
      case 'memoryIdArg': {
        const owner = nonEmptyString(first) ? memoryOwners.get(first) : undefined;
        if (owner) keys.add(owner);
        break;
      }
      case 'memoryIdArrayArg':
        if (Array.isArray(first)) {
          for (const id of first) {
            const owner = nonEmptyString(id) ? memoryOwners.get(id) : undefined;
            if (owner) keys.add(owner);
          }
        }
        break;
    }
  }
  return keys;
}
