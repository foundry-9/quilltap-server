/**
 * Whether a resolved wardrobe item may be put on — the one rule the
 * `wardrobe_wear` tool and the chat's `?action=equip` route share (bug 191).
 *
 * Item lookups (`findByIdForCharacter`, `findByIdsForCharacter`) include
 * archived items on purpose, so a garment archived after a chat dressed in it
 * can still be named. Putting one *on* is another matter: an archived item is
 * retired, and every wear path refuses it here with the same words.
 *
 * Client-safe (no server imports).
 *
 * @module lib/wardrobe/wearable
 */

import { WARDROBE_SLOT_TYPES, type EquippedSlots, type WardrobeItem } from '@/lib/schemas/wardrobe.types';

/** The refusal every wear path gives for an archived item. */
export function archivedWearMessage(title: string): string {
  return `Item "${title}" is archived and cannot be worn`;
}

/** Why `item` may not be put on, or null when it may. */
export function wearRefusal(item: Pick<WardrobeItem, 'title' | 'archivedAt'>): string | null {
  return item.archivedAt ? archivedWearMessage(item.title) : null;
}

/**
 * The archived items among `items` that a whole-outfit commit (`set_all`)
 * would newly put on. An archived item already in `currentSlots` stays where
 * it is: archiving never undresses anyone, so re-committing a fitting that
 * still holds it changes nothing about it.
 */
export function newlyWornArchivedItems(
  items: WardrobeItem[],
  currentSlots: EquippedSlots | null,
): WardrobeItem[] {
  const alreadyWorn = new Set<string>();
  if (currentSlots) {
    for (const slot of WARDROBE_SLOT_TYPES) {
      for (const id of currentSlots[slot] ?? []) alreadyWorn.add(id);
    }
  }
  return items.filter((item) => item.archivedAt && !alreadyWorn.has(item.id));
}
