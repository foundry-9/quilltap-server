/**
 * Outfit Displacement Utilities
 *
 * When equipping a wardrobe item, any items currently occupying conflicting
 * slots must be fully unequipped — including from slots beyond the one being
 * changed. For example, equipping a new top when a dress (types: ["top","bottom"])
 * is currently equipped should also clear the bottom slot.
 *
 * Similarly, when unequipping an item, all slots that item covers should be
 * set to null.
 *
 * @module wardrobe/outfit-displacement
 */

import { logger } from '@/lib/logger';
import type { EquippedSlots, WardrobeItemType } from '@/lib/schemas/wardrobe.types';
import { WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types';

/** Minimal repository interfaces needed for displacement logic */
export interface DisplacementRepos {
  wardrobe: {
    findById(id: string): Promise<{ id: string; types: WardrobeItemType[] } | null>;
  };
  chats: {
    getEquippedOutfitForCharacter(chatId: string, characterId: string): Promise<EquippedSlots | null>;
    setEquippedOutfit(chatId: string, characterId: string, slots: EquippedSlots): Promise<EquippedSlots | null>;
  };
}

/**
 * Compute the new equipped slots after equipping an item, with displacement.
 *
 * For each slot type of the new item:
 *   - If an existing item occupies that slot, ALL of that existing item's
 *     type slots are cleared (even ones the new item doesn't cover).
 *
 * Then the new item is placed in all its type slots.
 *
 * @returns The updated EquippedSlots after displacement and equipping
 */
export async function equipWithDisplacement(
  repos: DisplacementRepos,
  chatId: string,
  characterId: string,
  newItem: { id: string; types: WardrobeItemType[] }
): Promise<EquippedSlots> {
  const currentSlots = await repos.chats.getEquippedOutfitForCharacter(chatId, characterId);
  const slots: EquippedSlots = currentSlots
    ? { ...currentSlots }
    : { top: null, bottom: null, footwear: null, accessories: null };

  // Collect all item IDs that will be displaced
  const displacedItemIds = new Set<string>();
  for (const slotType of newItem.types) {
    const currentItemId = slots[slotType];
    if (currentItemId && currentItemId !== newItem.id) {
      displacedItemIds.add(currentItemId);
    }
  }

  // For each displaced item, clear ALL its type slots
  for (const displacedId of displacedItemIds) {
    const displacedItem = await repos.wardrobe.findById(displacedId);
    if (displacedItem) {
      for (const itemType of displacedItem.types) {
        // Only clear if still pointing to the displaced item
        if (slots[itemType] === displacedId) {
          slots[itemType] = null;
          logger.debug('[Outfit Displacement] Cleared displaced item from slot', {
            chatId, characterId, slot: itemType,
            displacedItemId: displacedId, newItemId: newItem.id,
            context: 'wardrobe',
          });
        }
      }
    }
  }

  // Equip the new item in all its type slots
  for (const slotType of newItem.types) {
    slots[slotType] = newItem.id;
  }

  // Persist the updated slots
  const result = await repos.chats.setEquippedOutfit(chatId, characterId, slots);

  logger.debug('[Outfit Displacement] Equipped item with displacement', {
    chatId, characterId,
    newItemId: newItem.id, newItemTypes: newItem.types,
    displacedCount: displacedItemIds.size,
    resultSlots: result,
    context: 'wardrobe',
  });

  return result ?? slots;
}

/**
 * Unequip an item from a slot, clearing ALL slots that item covers.
 *
 * If the slot is already empty, just returns the current state.
 * If the item in the slot covers multiple types, all are set to null.
 *
 * @returns The updated EquippedSlots after unequipping
 */
export async function unequipWithDisplacement(
  repos: DisplacementRepos,
  chatId: string,
  characterId: string,
  slot: WardrobeItemType
): Promise<EquippedSlots> {
  const currentSlots = await repos.chats.getEquippedOutfitForCharacter(chatId, characterId);
  const slots: EquippedSlots = currentSlots
    ? { ...currentSlots }
    : { top: null, bottom: null, footwear: null, accessories: null };

  const currentItemId = slots[slot];

  if (!currentItemId) {
    // Slot already empty, nothing to do
    return slots;
  }

  // Look up the item to find all its type slots
  const currentItem = await repos.wardrobe.findById(currentItemId);
  if (currentItem) {
    for (const itemType of currentItem.types) {
      if (slots[itemType] === currentItemId) {
        slots[itemType] = null;
        logger.debug('[Outfit Displacement] Cleared unequipped item from slot', {
          chatId, characterId, slot: itemType,
          itemId: currentItemId,
          context: 'wardrobe',
        });
      }
    }
  } else {
    // Item not found (deleted?), just clear the requested slot
    slots[slot] = null;
  }

  // Persist
  const result = await repos.chats.setEquippedOutfit(chatId, characterId, slots);

  logger.debug('[Outfit Displacement] Unequipped item with displacement', {
    chatId, characterId, slot,
    itemId: currentItemId,
    slotsCleared: currentItem?.types ?? [slot],
    context: 'wardrobe',
  });

  return result ?? slots;
}

/**
 * Apply displacement logic for optimistic frontend updates.
 *
 * Given the current slots, wardrobe items cache, the slot being changed,
 * and the new item ID (or null for unequip), returns the new slots state.
 *
 * This is a pure function (no DB access) for use in the frontend.
 */
export function computeDisplacedSlots(
  currentSlots: EquippedSlots,
  wardrobeItems: Array<{ id: string; types: string[] }>,
  slot: WardrobeItemType,
  newItemId: string | null
): EquippedSlots {
  const slots = { ...currentSlots };

  if (newItemId === null) {
    // Unequip: find what's in this slot and clear all its type slots
    const currentItemId = slots[slot];
    if (currentItemId) {
      const currentItem = wardrobeItems.find(i => i.id === currentItemId);
      if (currentItem) {
        for (const itemType of currentItem.types) {
          if (slots[itemType as WardrobeItemType] === currentItemId) {
            slots[itemType as WardrobeItemType] = null;
          }
        }
      } else {
        slots[slot] = null;
      }
    }
  } else {
    // Equip: find the new item's types, displace conflicting items, then equip
    const newItem = wardrobeItems.find(i => i.id === newItemId);
    const newItemTypes = newItem ? newItem.types : [slot];

    // Displace conflicting items
    for (const slotType of newItemTypes) {
      const currentItemId = slots[slotType as WardrobeItemType];
      if (currentItemId && currentItemId !== newItemId) {
        const currentItem = wardrobeItems.find(i => i.id === currentItemId);
        if (currentItem) {
          for (const itemType of currentItem.types) {
            if (slots[itemType as WardrobeItemType] === currentItemId) {
              slots[itemType as WardrobeItemType] = null;
            }
          }
        }
      }
    }

    // Equip in all the new item's type slots
    for (const slotType of newItemTypes) {
      slots[slotType as WardrobeItemType] = newItemId;
    }
  }

  return slots;
}
