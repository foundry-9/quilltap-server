/**
 * Wearable Pool Merge
 *
 * The one rule for folding a character's wardrobe tiers into the single list
 * of items that character can wear. Precedence is **character > group >
 * project > general**: a personal item with the same id as a shared one
 * shadows it (that's how a character keeps a private variant of a house
 * garment, and opts *out* of a shared default by holding a copy with
 * `isDefault: false`).
 *
 * Archived items are dropped from each tier *before* shadowing, so an archived
 * personal copy never hides the shared item it once overrode — the shared one
 * resurfaces.
 *
 * Pure and client-safe. The server's pool (`lib/wardrobe/pool.ts`) applies the
 * same rule; the client's merged character view calls this.
 *
 * @module wardrobe/wearable-pool
 */

import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';

/**
 * Merge tiers given weakest-first (General, project, group, then the
 * character's own) into the wearable list.
 */
export function mergeWearableTiers<T extends WardrobeItem>(tiersWeakestFirst: ReadonlyArray<readonly T[]>): T[] {
  const byId = new Map<string, T>();
  for (const tier of tiersWeakestFirst) {
    for (const item of tier) {
      if (!item.archivedAt) byId.set(item.id, item);
    }
  }
  return Array.from(byId.values());
}

/** {@link mergeWearableTiers} for one already-flattened shared list under the character's own. */
export function mergeWearablePool<T extends WardrobeItem>(shared: readonly T[], own: readonly T[]): T[] {
  return mergeWearableTiers([shared, own]);
}
