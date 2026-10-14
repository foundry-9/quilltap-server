/**
 * Equipped Outfit Resolution
 *
 * Helper for the read side of the wardrobe model. Equipped slots store arrays
 * of item IDs (which may be composites referencing other items). Most callers
 * want the same thing: a per-slot list of leaf items and their titles, ready
 * to feed into `describeOutfit` or to render in a prompt block.
 *
 * This helper walks the character's wearable pool (`lib/wardrobe/pool.ts`),
 * which already holds every tier the character can reach, archived items
 * included (an item archived after the chat last loaded still resolves to its
 * title):
 *   1. Expands each input slot's array via `expandComposites` over the pool,
 *      then routes each resulting leaf into every output slot the leaf's own
 *      `types` declares — dedup'd across input slots. An atomic dress with
 *      `types=[top,bottom]` shows up in both rendered slots even if it was
 *      only equipped to one, and a composite outfit whose components have
 *      heterogeneous types distributes those components correctly.
 *   2. Returns per-slot leaf items, the title-array `OutfitSlotValues` for
 *      `describeOutfit`, and the `itemsById` map of everything it touched.
 *
 * No I/O: the caller loads the pool once and may reuse it.
 *
 * @module wardrobe/resolve-equipped
 */
import { logger } from '@/lib/logger';
import { expandComposites } from '@/lib/wardrobe/expand-composites';
import {
  buildOutfitSlotValues,
  decorateOutfitItems,
  describeOutfit,
} from '@/lib/wardrobe/outfit-description';
import type { OutfitSlotValues } from '@/lib/wardrobe/outfit-description';
import { componentGraph, loadWearablePool, type WearablePool } from '@/lib/wardrobe/pool';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import {
  WARDROBE_SLOT_TYPES,
  allEquippedItemIds,
  bySlot,
} from '@/lib/schemas/wardrobe.types';
import type { EquippedSlots, WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types';

export interface ResolvedEquippedOutfit {
  /** Per-slot title arrays, ready for `describeOutfit`. */
  outfitValues: OutfitSlotValues;
  /** Per-slot leaf items (composites expanded), in the order they appear in equipped state. */
  leafItemsBySlot: Record<WardrobeItemType, WardrobeItem[]>;
  /** Every item id encountered during resolution (composites + leaves). */
  itemsById: Map<string, WardrobeItem>;
}

/** Fresh per-slot record with an empty array in every slot. */
function emptyBySlot<T>(): Record<WardrobeItemType, T[]> {
  return bySlot<T[]>(() => []);
}

function emptyResolved(): ResolvedEquippedOutfit {
  return {
    outfitValues: emptyBySlot<string>(),
    leafItemsBySlot: emptyBySlot<WardrobeItem>(),
    itemsById: new Map(),
  };
}

/**
 * Resolve a character's equipped slots into per-slot leaf items and a
 * `describeOutfit`-ready `OutfitSlotValues`. Composites are expanded
 * transitively via `expandComposites` over the pool.
 */
export function resolveEquippedOutfitForCharacter(
  pool: WearablePool,
  slots: EquippedSlots,
): ResolvedEquippedOutfit {
  const equippedItemIds = allEquippedItemIds(slots);

  if (equippedItemIds.length === 0) {
    return emptyResolved();
  }

  const itemsById: Map<string, WardrobeItem> = componentGraph(pool, equippedItemIds);
  const unresolved = equippedItemIds.filter((id) => !itemsById.has(id));
  if (unresolved.length > 0) {
    logger.debug('[resolveEquippedOutfitForCharacter] Equipped ids not in the wearable pool', {
      context: 'wardrobe',
      characterId: pool.characterId,
      unresolvedCount: unresolved.length,
    });
  }

  // First pass: expand each input slot's composites, dedupe by leaf id across
  // the whole equipped set, and remember the order leaves were first seen.
  // Second pass: route each leaf into every output slot its own `types`
  // declares. That spreads atomic multi-slot items (a dress with
  // `types=[top,bottom]` lands in both rendered slots) and routes composite
  // components to the slots their own `types` say (a "casual outfit"
  // composite whose components are blouse(top)/slacks(bottom)/loafers(footwear)
  // distributes correctly even if the composite itself was equipped to one
  // slot).
  const leafItemsBySlot: ResolvedEquippedOutfit['leafItemsBySlot'] = emptyBySlot<WardrobeItem>();
  const outfitValues: OutfitSlotValues = emptyBySlot<string>();

  const seenLeafIds = new Set<string>();
  const orderedLeaves: WardrobeItem[] = [];
  for (const slot of WARDROBE_SLOT_TYPES) {
    // `?? []` is load-bearing: a slot bag written before this slot existed has
    // no key at all, and `expandComposites` iterates what it is handed.
    const expanded = expandComposites(slots[slot] ?? [], itemsById);
    if (expanded.cycles.length > 0 || expanded.truncated) {
      logger.warn('[resolveEquippedOutfitForCharacter] Malformed composite graph; expansion truncated', {
        context: 'wardrobe',
        characterId: pool.characterId,
        slot,
        cycles: expanded.cycles.length,
        truncated: expanded.truncated,
      });
    }
    for (const id of expanded.leafIds) {
      if (seenLeafIds.has(id)) continue;
      const item = itemsById.get(id);
      if (!item) continue;
      seenLeafIds.add(id);
      orderedLeaves.push(item);
    }
  }

  for (const item of orderedLeaves) {
    // A leaf's `types` declare which slots it covers. Route into each.
    // If `types` is somehow empty (shouldn't happen — the schema requires
    // min(1)), fall back to no-op rather than guessing.
    for (const slot of item.types) {
      if (!WARDROBE_SLOT_TYPES.includes(slot)) continue;
      leafItemsBySlot[slot].push(item);
      outfitValues[slot].push(item.title);
    }
  }

  return { outfitValues, leafItemsBySlot, itemsById };
}

/**
 * Describe a character's currently equipped outfit as a concise, title-only
 * markdown block — the shared "what are they wearing right now" pipeline for
 * prompt builders that must stay terse (scene-state baselines, mid-turn
 * clothing overrides). The project tier is passed in, already resolved by the
 * caller; the pool resolves the group tier itself.
 */
export async function describeEquippedOutfitTitleOnly(
  repos: Pick<RepositoryContainer, 'wardrobe' | 'projects' | 'chats'>,
  characterId: string,
  equippedSlots: EquippedSlots,
  projectMountPointIds: string[] | undefined,
): Promise<string> {
  const pool = await loadWearablePool(repos, characterId, projectMountPointIds ?? []);
  const resolved = resolveEquippedOutfitForCharacter(pool, equippedSlots);
  return describeOutfit(
    buildOutfitSlotValues((slot) =>
      decorateOutfitItems(resolved.leafItemsBySlot[slot], { titleOnly: true }),
    ),
  );
}
