/**
 * Which characters' in-process memory-index caches a committed write batch
 * made stale (bug 217; memory refactor Phase B).
 *
 * `memories.embedding` and `memories.tier` are the index; each character's
 * in-process store is a cache of them (`lib/memory/index-store/`). A batch from
 * the job child that wrote either column, or deleted a row, leaves the
 * parent's cache for that character stale, and the dispatcher drops it after
 * the commit (and tells the child to drop its own).
 *
 * The repository writes that do so do not all name the character the same
 * way, so each method states its argument shape once. Memory-id-keyed writes
 * are resolved to their owners by the caller *before* the batch commits.
 *
 * @module background-jobs/host/vector-store-invalidation
 */

import type { ChildWritePayload } from '../ipc-types';

/** How a write method names the character whose cache it touches. */
type CharacterKeyShape =
  /** `method(characterId, ...)` */
  | 'characterArg'
  /** `method({ characterId, ... }, ...)` */
  | 'characterField'
  /** `method(memoryId, ...)` — owner resolved before commit */
  | 'memoryIdArg';

/**
 * Every repository write that can change what a character's memory-index
 * cache holds: a vector added or changed, a row removed, a tier moved.
 *
 * Link, count and footnote writes (`incrementReinforcement`,
 * `addRelatedMemoryIds`, `appendReinforcementFootnotes`, …) are deliberately
 * absent: the cache holds only id, vector and tier, and listing them dropped
 * the character's cache after nearly every turn.
 */
export const VECTOR_STORE_WRITE_SHAPES: Readonly<Record<string, CharacterKeyShape>> = {
  'memories.create': 'characterField',
  'memories.upsert': 'characterField',
  'memories.updateForCharacter': 'characterArg',
  'memories.bulkDeleteUnsafe': 'characterArg',
  'memories.updateTierBulk': 'characterArg',
  'memories.update': 'memoryIdArg',
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
      case 'memoryIdArg': {
        const owner = nonEmptyString(first) ? memoryOwners.get(first) : undefined;
        if (owner) keys.add(owner);
        break;
      }
    }
  }
  return keys;
}
