/**
 * Built-in character reset: which ids the re-imported Lorian and Riya take.
 *
 * Reset Built-in Characters deletes the pair and imports the seed bundle
 * again. The chats, memberships and links that named the old rows must keep
 * resolving, so each character comes back under the id it had. The importer
 * only honours a bundle's ids when asked to preserve them, and then refuses
 * the whole import if any claimed id is already taken — so this module decides
 * every id the bundle will claim before the import runs:
 *
 * - a built-in that existed keeps its id;
 * - one that did not takes the seed's id when that id is free, else a new one
 *   (a renamed copy of an earlier reset may still hold the seed's id);
 * - every memory gets a new id, because memories from an earlier reset may
 *   still exist under a renamed character.
 *
 * Pure apart from the injected `isCharacterIdTaken` and `newId`.
 *
 * @module characters/builtin-reset
 */

import { randomUUID } from 'crypto';

export const BUILTIN_CHARACTER_NAMES = ['Lorian', 'Riya'] as const;

export type BuiltinCharacterName = (typeof BUILTIN_CHARACTER_NAMES)[number];

interface SeedShape {
  data?: {
    characters?: Array<{ id?: unknown; name?: unknown }>;
    memories?: Array<{ id?: unknown }>;
  };
}

/** The seed bundle's own id for each built-in it carries, keyed by name. */
export function findBuiltinCharacterIds(seedImportData: unknown): Record<string, string> {
  const characters = (seedImportData as SeedShape | null | undefined)?.data?.characters;
  if (!Array.isArray(characters)) return {};

  const seedIdByName: Record<string, string> = {};
  for (const entry of characters) {
    if (entry && typeof entry.name === 'string' && typeof entry.id === 'string') {
      seedIdByName[entry.name] = entry.id;
    }
  }
  return seedIdByName;
}

/** Replace every string equal to a mapped id, anywhere in `value`. */
export function replaceMappedIdsRecursively(value: unknown, idMapping: Map<string, string>): unknown {
  if (typeof value === 'string') {
    return idMapping.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceMappedIdsRecursively(item, idMapping));
  }
  if (value && typeof value === 'object') {
    const next: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      next[key] = replaceMappedIdsRecursively(nestedValue, idMapping);
    }
    return next;
  }
  return value;
}

export interface BuiltinResetPlan<T> {
  /** The seed bundle with every claimed id rewritten; import it with `preserveIds`. */
  data: T;
  /** The id each built-in will have after the import, keyed by name. */
  characterIds: Record<string, string>;
  /** How many seed ids were rewritten (characters and memories). */
  remappedIdCount: number;
}

/**
 * Rewrite the seed bundle so a `preserveIds` import lands each built-in on the
 * id it should keep and cannot collide with a row that survived the delete.
 *
 * Call it after the existing built-ins have been deleted: `isCharacterIdTaken`
 * is asked only about a seed id for a built-in that had no row to preserve.
 */
export async function planBuiltinReset<T>(
  seedImportData: T,
  preservedIds: Record<string, string | null | undefined>,
  isCharacterIdTaken: (id: string) => Promise<boolean>,
  newId: () => string = randomUUID
): Promise<BuiltinResetPlan<T>> {
  const seedIdByName = findBuiltinCharacterIds(seedImportData);
  const idMapping = new Map<string, string>();
  const characterIds: Record<string, string> = {};

  for (const [name, seedId] of Object.entries(seedIdByName)) {
    const preserved = preservedIds[name];
    const target = preserved ?? ((await isCharacterIdTaken(seedId)) ? newId() : seedId);
    characterIds[name] = target;
    if (target !== seedId) idMapping.set(seedId, target);
  }

  const memories = (seedImportData as SeedShape | null | undefined)?.data?.memories;
  if (Array.isArray(memories)) {
    for (const memory of memories) {
      if (memory && typeof memory.id === 'string') idMapping.set(memory.id, newId());
    }
  }

  return {
    data: replaceMappedIdsRecursively(seedImportData, idMapping) as T,
    characterIds,
    remappedIdCount: idMapping.size,
  };
}
