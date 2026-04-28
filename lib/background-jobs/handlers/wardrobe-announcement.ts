/**
 * Wardrobe Outfit Announcement Handler
 *
 * Posts a synthetic ASSISTANT-role chat message authored by Aurora summarising
 * a character's current outfit after a quiet period of wardrobe changes. The
 * job is enqueued (and rescheduled) by enqueueWardrobeOutfitAnnouncement and
 * fires once the debounce window has elapsed without further activity.
 *
 * Phase D of the system-prompt refactor: this announcement is now the single
 * source of truth for outfit state, replacing both the per-turn
 * `## Current Outfit` / `## Available Wardrobe` system-prompt blocks and the
 * `pendingOutfitNotifications` per-turn notice.
 */

import { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import type { WardrobeOutfitAnnouncementPayload } from '../queue-service';
import { postOutfitChangeWhisper } from '@/lib/services/aurora-notifications/writer';

export async function handleWardrobeOutfitAnnouncement(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as WardrobeOutfitAnnouncementPayload;
  const { chatId, characterId } = payload;

  logger.info('[WardrobeAnnouncement] Starting announcement', {
    context: 'background-jobs.wardrobe-announcement',
    jobId: job.id,
    chatId,
    characterId,
  });

  const repos = getRepositories();

  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    logger.debug('[WardrobeAnnouncement] Chat not found, skipping', {
      context: 'background-jobs.wardrobe-announcement',
      chatId,
      characterId,
    });
    return;
  }

  const equippedOutfit = (chat.equippedOutfit as Record<string, {
    top: string | null;
    bottom: string | null;
    footwear: string | null;
    accessories: string | null;
  }> | null) ?? {};
  const slots = equippedOutfit[characterId];
  if (!slots) {
    logger.debug('[WardrobeAnnouncement] No equipped slots for character, skipping', {
      context: 'background-jobs.wardrobe-announcement',
      chatId,
      characterId,
    });
    return;
  }

  const equippedItemIds = Object.values(slots).filter((id): id is string => Boolean(id));
  const equippedItems = equippedItemIds.length > 0
    ? await repos.wardrobe.findByIds(equippedItemIds)
    : [];
  const itemsById = new Map(equippedItems.map((i) => [i.id, i]));
  const titleFor = (slotId: string | null): string | null => {
    if (!slotId) return null;
    return itemsById.get(slotId)?.title ?? null;
  };

  const character = await repos.characters.findById(characterId);
  const charName = character?.name ?? 'A character';

  const allWardrobeItems = await repos.wardrobe.findByCharacterId(characterId);
  const equippedIdSet = new Set(equippedItemIds);
  const availableItems = allWardrobeItems
    .filter((w) => !equippedIdSet.has(w.id))
    .map((w) => ({ title: w.title }));

  await postOutfitChangeWhisper({
    chatId,
    characterName: charName,
    outfit: {
      top: titleFor(slots.top),
      bottom: titleFor(slots.bottom),
      footwear: titleFor(slots.footwear),
      accessories: titleFor(slots.accessories),
    },
    availableItems,
  });
}
