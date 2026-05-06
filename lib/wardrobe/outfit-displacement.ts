/**
 * Outfit Equip Primitives
 *
 * Three primitives mutate equipped state, named after their cascade rule:
 *
 *   - `equipItem(item)`  — replace each slot in `item.types` with `[item.id]`.
 *                          The default behavior of "putting something on";
 *                          composites are stored as their own id, expansion
 *                          to leaves happens at read time.
 *   - `addToSlot(item, slot)` — append `item.id` to that slot's array.
 *                               For layering ("also wear the cardigan").
 *   - `removeFromSlot(slot, itemId?)` — filter `itemId` out of the slot's
 *                                       array. With `itemId` omitted, clears
 *                                       the slot entirely.
 *
 * `computeDisplacedSlots` is a pure (no-DB) variant for frontend optimistic
 * updates and unit tests.
 *
 * @module wardrobe/outfit-displacement
 */

import { logger } from '@/lib/logger';
import type { EquippedSlots, WardrobeItemType } from '@/lib/schemas/wardrobe.types';

/** Minimal repository interfaces needed for these primitives */
export interface DisplacementRepos {
  chats: {
    getEquippedOutfitForCharacter(chatId: string, characterId: string): Promise<EquippedSlots | null>;
    setEquippedOutfit(chatId: string, characterId: string, slots: EquippedSlots): Promise<EquippedSlots | null>;
  };
}

function freshSlots(): EquippedSlots {
  return { top: [], bottom: [], footwear: [], accessories: [] };
}

function cloneSlots(slots: EquippedSlots): EquippedSlots {
  return {
    top: [...slots.top],
    bottom: [...slots.bottom],
    footwear: [...slots.footwear],
    accessories: [...slots.accessories],
  };
}

async function loadSlots(
  repos: DisplacementRepos,
  chatId: string,
  characterId: string,
): Promise<EquippedSlots> {
  const current = await repos.chats.getEquippedOutfitForCharacter(chatId, characterId);
  return current ? cloneSlots(current) : freshSlots();
}

/**
 * Equip an item: for each slot in `item.types`, replace that slot's array
 * with `[item.id]`. Existing items in the affected slots are dropped.
 *
 * Composite items are stored as their own ID — expansion to leaves happens
 * at read time via `expandComposites`.
 */
export async function equipItem(
  repos: DisplacementRepos,
  chatId: string,
  characterId: string,
  newItem: { id: string; types: WardrobeItemType[] },
): Promise<EquippedSlots> {
  const slots = await loadSlots(repos, chatId, characterId);

  for (const slotType of newItem.types) {
    slots[slotType] = [newItem.id];
  }

  const result = await repos.chats.setEquippedOutfit(chatId, characterId, slots);

  logger.debug('[Outfit] Equipped item (replace)', {
    context: 'wardrobe',
    chatId, characterId,
    itemId: newItem.id,
    types: newItem.types,
    resultSlots: result,
  });

  return result ?? slots;
}

/**
 * Append `item.id` to the given slot's array. Validates that
 * `slot ∈ item.types`. No-op if the item is already in the slot.
 */
export async function addToSlot(
  repos: DisplacementRepos,
  chatId: string,
  characterId: string,
  slot: WardrobeItemType,
  item: { id: string; types: WardrobeItemType[] },
): Promise<EquippedSlots> {
  if (!item.types.includes(slot)) {
    throw new Error(
      `Item ${item.id} (types=[${item.types.join(',')}]) cannot occupy slot '${slot}'`,
    );
  }

  const slots = await loadSlots(repos, chatId, characterId);

  if (!slots[slot].includes(item.id)) {
    slots[slot] = [...slots[slot], item.id];
  }

  const result = await repos.chats.setEquippedOutfit(chatId, characterId, slots);
  logger.debug('[Outfit] Added item to slot', {
    context: 'wardrobe',
    chatId, characterId, slot,
    itemId: item.id,
    resultSlots: result,
  });
  return result ?? slots;
}

/**
 * Remove a specific item from the given slot's array. If `itemId` is
 * omitted, clears the slot entirely.
 */
export async function removeFromSlot(
  repos: DisplacementRepos,
  chatId: string,
  characterId: string,
  slot: WardrobeItemType,
  itemId?: string,
): Promise<EquippedSlots> {
  const slots = await loadSlots(repos, chatId, characterId);

  if (!itemId) {
    slots[slot] = [];
  } else {
    slots[slot] = slots[slot].filter((id) => id !== itemId);
  }

  const result = await repos.chats.setEquippedOutfit(chatId, characterId, slots);
  logger.debug('[Outfit] Removed item from slot', {
    context: 'wardrobe',
    chatId, characterId, slot,
    itemId: itemId ?? null,
    resultSlots: result,
  });
  return result ?? slots;
}

/** Pure-function variants for frontend optimistic updates. */

export type DisplacementMode = 'equip' | 'add_to_slot' | 'remove_from_slot' | 'clear_slot';

export interface ComputeDisplacedOptions {
  mode: DisplacementMode;
  /** Required for `equip` and `add_to_slot`. */
  item?: { id: string; types: string[] };
  /** Required for `add_to_slot`, `remove_from_slot`, `clear_slot`. */
  slot?: WardrobeItemType;
  /** Filter target for `remove_from_slot`; omit to clear the slot. */
  itemId?: string;
}

export function computeDisplacedSlots(
  currentSlots: EquippedSlots,
  options: ComputeDisplacedOptions,
): EquippedSlots {
  const slots = cloneSlots(currentSlots);

  if (options.mode === 'equip') {
    if (!options.item) return slots;
    for (const slotType of options.item.types as WardrobeItemType[]) {
      slots[slotType] = [options.item.id];
    }
    return slots;
  }

  if (options.mode === 'add_to_slot') {
    if (!options.item || !options.slot) return slots;
    if (!slots[options.slot].includes(options.item.id)) {
      slots[options.slot] = [...slots[options.slot], options.item.id];
    }
    return slots;
  }

  if (options.mode === 'remove_from_slot') {
    if (!options.slot) return slots;
    if (!options.itemId) {
      slots[options.slot] = [];
    } else {
      const target = options.itemId;
      slots[options.slot] = slots[options.slot].filter((id) => id !== target);
    }
    return slots;
  }

  if (options.mode === 'clear_slot') {
    if (!options.slot) return slots;
    slots[options.slot] = [];
    return slots;
  }

  return slots;
}
