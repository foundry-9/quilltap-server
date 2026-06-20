/**
 * Equipped-Outfit Hashing
 *
 * Single source of truth for deciding whether a character's equipped wardrobe
 * has changed. The concise clothing summary cached in `chat.sceneState` is
 * keyed by this hash: the scene-state tracker reuses the cached summary while
 * the hash is unchanged, and the context manager compares the live wardrobe's
 * hash against the cached one to detect a mid-turn wardrobe edit.
 *
 * @module wardrobe/outfit-hash
 */

import { createHash } from 'node:crypto';
import type { EquippedSlots } from '@/lib/schemas/wardrobe.types';

const OUTFIT_HASH_LENGTH = 16;

/**
 * Deterministic short hash of a character's equipped wardrobe slots. Layering
 * order within a slot is significant (an outer layer hides an inner one), so
 * each slot's array is hashed in its stored order; only the slot-key order is
 * normalized. Two equipped states hash equal iff every slot holds the same item
 * ids in the same order. A null/empty outfit hashes to a stable sentinel.
 */
export function hashEquippedSlots(slots: EquippedSlots | null | undefined): string {
  const normalized = {
    top: slots?.top ?? [],
    bottom: slots?.bottom ?? [],
    footwear: slots?.footwear ?? [],
    accessories: slots?.accessories ?? [],
  };
  return createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex')
    .slice(0, OUTFIT_HASH_LENGTH);
}

/** True when at least one slot holds an equipped item. */
export function hasEquippedItems(slots: EquippedSlots | null | undefined): boolean {
  if (!slots) return false;
  return (
    (slots.top?.length ?? 0) +
      (slots.bottom?.length ?? 0) +
      (slots.footwear?.length ?? 0) +
      (slots.accessories?.length ?? 0) >
    0
  );
}
