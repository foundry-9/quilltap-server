/**
 * Equipped Outfit Resolution
 *
 * Helper for the read side of the wardrobe model. Equipped slots store arrays
 * of item IDs (which may be composites referencing other items). Most callers
 * want the same thing: a per-slot list of leaf items and their titles, ready
 * to feed into `describeOutfit` or to render in a prompt block.
 *
 * This helper:
 *   1. Loads every wardrobe item belonging to the character (so the
 *      `itemsById` map can resolve composite components transitively).
 *   2. Falls back to `wardrobe.findByIds` for any equipped IDs not found in
 *      the character's own wardrobe (archetype items, etc.).
 *   3. Expands each slot's array independently via `expandComposites`.
 *   4. Returns per-slot leaf items, the title-array `OutfitSlotValues` for
 *      `describeOutfit`, and the underlying `itemsById` map for callers that
 *      still want to inspect items themselves.
 *
 * @module wardrobe/resolve-equipped
 */
import { logger } from '@/lib/logger';
import { expandComposites } from '@/lib/wardrobe/expand-composites';
import type { OutfitSlotValues } from '@/lib/wardrobe/outfit-description';
import type { EquippedSlots, WardrobeItem } from '@/lib/schemas/wardrobe.types';

/** Minimal repository surface needed to resolve equipped items. */
export interface ResolveEquippedRepos {
  wardrobe: {
    findByCharacterId(characterId: string, includeArchived?: boolean): Promise<WardrobeItem[]>;
    findByIds(ids: string[]): Promise<WardrobeItem[]>;
  };
}

export interface ResolvedEquippedOutfit {
  /** Per-slot title arrays, ready for `describeOutfit`. */
  outfitValues: OutfitSlotValues;
  /** Per-slot leaf items (composites expanded), in the order they appear in equipped state. */
  leafItemsBySlot: {
    top: WardrobeItem[];
    bottom: WardrobeItem[];
    footwear: WardrobeItem[];
    accessories: WardrobeItem[];
  };
  /** Map of every item id encountered during resolution (composites + leaves). */
  itemsById: Map<string, WardrobeItem>;
}

const SLOT_KEYS = ['top', 'bottom', 'footwear', 'accessories'] as const;
type SlotKey = (typeof SLOT_KEYS)[number];

function emptyResolved(): ResolvedEquippedOutfit {
  return {
    outfitValues: { top: [], bottom: [], footwear: [], accessories: [] },
    leafItemsBySlot: { top: [], bottom: [], footwear: [], accessories: [] },
    itemsById: new Map(),
  };
}

/**
 * Resolve a character's equipped slots into per-slot leaf items and a
 * `describeOutfit`-ready `OutfitSlotValues`. Composites are expanded
 * transitively via `expandComposites`.
 *
 * Pass the character's own id when known — that lets us load the full
 * character wardrobe (honouring the document-store overlay) and resolve
 * composite components even when they're not equipped themselves.
 */
export async function resolveEquippedOutfitForCharacter(
  repos: ResolveEquippedRepos,
  characterId: string,
  slots: EquippedSlots,
): Promise<ResolvedEquippedOutfit> {
  const equippedItemIds = Array.from(new Set([
    ...slots.top,
    ...slots.bottom,
    ...slots.footwear,
    ...slots.accessories,
  ]));

  if (equippedItemIds.length === 0) {
    return emptyResolved();
  }

  // Pull everything in the character's wardrobe so transitive composite
  // components resolve. Include archived: an item that's been archived after
  // the chat last loaded should still resolve to its title for display.
  let charItems: WardrobeItem[] = [];
  try {
    charItems = await repos.wardrobe.findByCharacterId(characterId, true);
  } catch (error) {
    logger.warn('[resolveEquippedOutfitForCharacter] findByCharacterId failed; proceeding with findByIds only', {
      context: 'wardrobe',
      characterId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const itemsById = new Map<string, WardrobeItem>(charItems.map((i) => [i.id, i]));

  // Fill in any equipped ids the character wardrobe didn't supply (archetype
  // items, items from another character if the chat permits, etc.).
  const missing = equippedItemIds.filter((id) => !itemsById.has(id));
  if (missing.length > 0) {
    try {
      const fallback = await repos.wardrobe.findByIds(missing);
      for (const item of fallback) {
        itemsById.set(item.id, item);
      }
    } catch (error) {
      logger.warn('[resolveEquippedOutfitForCharacter] findByIds fallback failed', {
        context: 'wardrobe',
        characterId,
        missingCount: missing.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Per-slot expansion: each slot is independent. Composites are expanded to
  // leaves, and leaves stay as leaves.
  const leafItemsBySlot: ResolvedEquippedOutfit['leafItemsBySlot'] = {
    top: [],
    bottom: [],
    footwear: [],
    accessories: [],
  };
  const outfitValues: OutfitSlotValues = {
    top: [],
    bottom: [],
    footwear: [],
    accessories: [],
  };

  for (const slot of SLOT_KEYS) {
    const expanded = expandComposites(slots[slot], itemsById);
    if (expanded.cycles.length > 0 || expanded.truncated) {
    }
    for (const id of expanded.leafIds) {
      const item = itemsById.get(id);
      if (!item) continue;
      leafItemsBySlot[slot].push(item);
      outfitValues[slot].push(item.title);
    }
  }

  return { outfitValues, leafItemsBySlot, itemsById };
}

/**
 * Convenience: resolve equipped slots into a `WardrobeItem[]` flat list,
 * preserving slot iteration order (top → bottom → footwear → accessories)
 * and deduplicating by id. Useful for callers that only need the items.
 */
export function flattenLeafItems(resolved: ResolvedEquippedOutfit): WardrobeItem[] {
  const seen = new Set<string>();
  const out: WardrobeItem[] = [];
  for (const slot of SLOT_KEYS as readonly SlotKey[]) {
    for (const item of resolved.leafItemsBySlot[slot]) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}
