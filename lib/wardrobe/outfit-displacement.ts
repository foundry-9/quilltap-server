/**
 * Outfit Equip Primitives
 *
 * Every "put it on" gesture obeys a single rule, keyed on the item's `replace`
 * flag and applied to *each* slot the item's `types` designate:
 *
 *   - `replace: false` (the default for both leaf garments and additive
 *     bundles) — the item is *layered* into the slot: its id is appended,
 *     keeping whatever is already there.
 *   - `replace: true` — the item *replaces* the slot: the slot becomes just
 *     `[item.id]`. Used for full-outfit swaps and "clear everything" bundles
 *     like Naked.
 *
 * Composite items are stored as their own id; expansion to leaf garments
 * happens at read time via `expandComposites`. There is no longer a
 * leaf-vs-composite special case — the flag is the single source of truth.
 *
 * Primitives:
 *
 *   - `wearItemIntoSlots` / `equipItem(item)` — the flag-driven rule above.
 *   - `replaceItemIntoSlots` / `replaceItem(item)` — force-swap: each
 *     designated slot is cleared and set to `[item.id]`, ignoring the flag.
 *     The "clear the slot, then put this on" gesture.
 *   - `addToSlot(item, slot)` — append `item.id` to one named slot's array
 *     (granular layering — "also wear the cardigan").
 *   - `removeFromSlot(slot, itemId?)` — filter `itemId` out of the slot's
 *     array. With `itemId` omitted, clears the slot entirely.
 *
 * `wearItemIntoSlots` / `replaceItemIntoSlots` / `computeDisplacedSlots` are
 * pure (no-DB) variants for frontend optimistic updates and unit tests.
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
 * Pure flag-driven wear: for each slot in `item.types`, replace the slot with
 * `[item.id]` when `item.replace` is true, otherwise append `item.id`
 * (layering, no-op if already present). The single rule behind every "put it
 * on" gesture — see the module doc. No DB access.
 */
export function wearItemIntoSlots(
  currentSlots: EquippedSlots,
  item: { id: string; types: WardrobeItemType[]; replace?: boolean },
): EquippedSlots {
  const slots = cloneSlots(currentSlots);
  for (const slotType of item.types) {
    if (item.replace) {
      slots[slotType] = [item.id];
    } else if (!slots[slotType].includes(item.id)) {
      slots[slotType] = [...slots[slotType], item.id];
    }
  }
  return slots;
}

/**
 * Pure force-swap: clear each slot in `item.types` and set it to `[item.id]`,
 * regardless of the `replace` flag. The "clear the slot, then put this on"
 * gesture. No DB access.
 */
export function replaceItemIntoSlots(
  currentSlots: EquippedSlots,
  item: { id: string; types: WardrobeItemType[] },
): EquippedSlots {
  const slots = cloneSlots(currentSlots);
  for (const slotType of item.types) {
    slots[slotType] = [item.id];
  }
  return slots;
}

/**
 * Wear an item into the slots its `types` designate, honoring the item's
 * `replace` flag (layer when false, replace when true — see
 * `wearItemIntoSlots`). The same rule for leaf garments and bundles alike.
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
  const next = wearItemIntoSlots(slots, newItem);
  const result = await repos.chats.setEquippedOutfit(chatId, characterId, next);
  return result ?? next;
}

/**
 * Force-swap an item into the slots its `types` designate: each is cleared and
 * set to `[item.id]`, ignoring the `replace` flag. The persisted counterpart
 * of `replaceItemIntoSlots`.
 */
export async function replaceItem(
  repos: DisplacementRepos,
  chatId: string,
  characterId: string,
  newItem: { id: string; types: WardrobeItemType[] },
): Promise<EquippedSlots> {
  const slots = await loadSlots(repos, chatId, characterId);
  const next = replaceItemIntoSlots(slots, newItem);
  const result = await repos.chats.setEquippedOutfit(chatId, characterId, next);
  return result ?? next;
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

export type DisplacementMode = 'wear' | 'replace' | 'add_to_slot' | 'remove_from_slot' | 'clear_slot';

export interface ComputeDisplacedOptions {
  mode: DisplacementMode;
  /** Required for `wear`, `replace`, and `add_to_slot`. `replace` (the flag)
   *  drives `wear`'s layer-vs-replace behaviour (see `wearItemIntoSlots`). */
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

  if (options.mode === 'wear') {
    if (!options.item) return slots;
    return wearItemIntoSlots(slots, {
      id: options.item.id,
      types: options.item.types as WardrobeItemType[],
      replace: options.item.replace,
    });
  }

  if (options.mode === 'replace') {
    if (!options.item) return slots;
    return replaceItemIntoSlots(slots, {
      id: options.item.id,
      types: options.item.types as WardrobeItemType[],
    });
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
