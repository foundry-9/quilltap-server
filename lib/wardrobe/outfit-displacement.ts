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
 * Equip an item into the slots its `types` designate.
 *
 * - **Leaf items** (no components) always *replace* each designated slot with
 *   `[item.id]` — "wear these jeans" swaps out the current bottom.
 * - **Composites** consult their `replace` flag:
 *     - `replace: false` (the default) is *additive* — the composite id is
 *       appended to each designated slot, layering its components onto whatever
 *       is already there. Nothing is cleared.
 *     - `replace: true` clears each designated slot and places only the
 *       composite (e.g. a full-outfit swap, or "Naked" designating every slot).
 *
 * Composite items are stored as their own ID — expansion to leaves happens at
 * read time via `expandComposites`.
 */
export async function equipItem(
  repos: DisplacementRepos,
  chatId: string,
  characterId: string,
  newItem: { id: string; types: WardrobeItemType[]; componentItemIds?: string[]; replace?: boolean },
): Promise<EquippedSlots> {
  const slots = await loadSlots(repos, chatId, characterId);

  const isComposite = (newItem.componentItemIds?.length ?? 0) > 0;
  const additive = isComposite && newItem.replace !== true;

  for (const slotType of newItem.types) {
    if (additive) {
      if (!slots[slotType].includes(newItem.id)) {
        slots[slotType] = [...slots[slotType], newItem.id];
      }
    } else {
      slots[slotType] = [newItem.id];
    }
  }

  const result = await repos.chats.setEquippedOutfit(chatId, characterId, slots);

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
  return result ?? slots;
}

/** Pure-function variants for frontend optimistic updates. */

export type DisplacementMode = 'equip' | 'add_to_slot' | 'remove_from_slot' | 'clear_slot';

export interface ComputeDisplacedOptions {
  mode: DisplacementMode;
  /** Required for `equip` and `add_to_slot`. `componentItemIds`/`replace` drive
   *  composite additive-vs-replace behaviour (see `equipItem`). */
  item?: { id: string; types: string[]; componentItemIds?: string[]; replace?: boolean };
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
    const isComposite = (options.item.componentItemIds?.length ?? 0) > 0;
    const additive = isComposite && options.item.replace !== true;
    for (const slotType of options.item.types as WardrobeItemType[]) {
      if (additive) {
        if (!slots[slotType].includes(options.item.id)) {
          slots[slotType] = [...slots[slotType], options.item.id];
        }
      } else {
        slots[slotType] = [options.item.id];
      }
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
