import { logger } from '@/lib/logger';
import { EMPTY_EQUIPPED_SLOTS, buildCoverageSummary, WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types';
import type { EquippedSlots, WardrobeItem } from '@/lib/schemas/wardrobe.types';
import { expandComposites } from '@/lib/wardrobe/expand-composites';
import { enqueueWardrobeOutfitAnnouncement } from '@/lib/background-jobs/queue-service';

interface WardrobeReposForSummary {
  chats: {
    getEquippedOutfitForCharacter(chatId: string, characterId: string): Promise<EquippedSlots | null>;
  };
  wardrobe: {
    findByIds(ids: string[]): Promise<WardrobeItem[]>;
  };
}

export function emptyEquippedState(): EquippedSlots {
  return { ...EMPTY_EQUIPPED_SLOTS };
}

export async function loadCurrentWardrobeState(
  repos: WardrobeReposForSummary,
  chatId: string,
  characterId: string,
): Promise<EquippedSlots> {
  const equippedOutfit = await repos.chats.getEquippedOutfitForCharacter(chatId, characterId);
  return equippedOutfit ?? emptyEquippedState();
}

export async function buildWardrobeCoverageSummaryFromState(
  repos: WardrobeReposForSummary,
  slots: EquippedSlots,
): Promise<string> {
  const allIds = new Set<string>();
  for (const slotKey of WARDROBE_SLOT_TYPES) {
    for (const id of slots[slotKey]) allIds.add(id);
  }

  const itemsById = new Map<string, WardrobeItem>();
  if (allIds.size > 0) {
    const fetched = await repos.wardrobe.findByIds(Array.from(allIds));
    for (const item of fetched) itemsById.set(item.id, item);
  }

  const perSlotItems: Record<keyof EquippedSlots, WardrobeItem[]> = {
    top: [],
    bottom: [],
    footwear: [],
    accessories: [],
  };

  for (const slotKey of WARDROBE_SLOT_TYPES) {
    const equippedIds = slots[slotKey];
    if (equippedIds.length === 0) continue;

    const { leafIds } = expandComposites(equippedIds, itemsById);
    const seen = new Set<string>();
    for (const leafId of leafIds) {
      if (seen.has(leafId)) continue;
      const leaf = itemsById.get(leafId);
      if (!leaf) continue;
      if (!leaf.types.includes(slotKey)) continue;
      perSlotItems[slotKey].push(leaf);
      seen.add(leafId);
    }
  }

  return buildCoverageSummary(slots, perSlotItems);
}

export async function scheduleWardrobeAnnouncement(
  sourceContext: string,
  args: {
    userId: string;
    chatId: string;
    characterId: string;
    extraLogFields?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await enqueueWardrobeOutfitAnnouncement(args.userId, {
      chatId: args.chatId,
      characterId: args.characterId,
    });
  } catch (error) {
    logger.warn('Failed to schedule wardrobe outfit announcement', {
      context: sourceContext,
      chatId: args.chatId,
      characterId: args.characterId,
      ...(args.extraLogFields ?? {}),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
