/**
 * Wardrobe Outfit Announcement Handler
 *
 * Posts a synthetic ASSISTANT-role chat message authored by Aurora summarising
 * a character's current outfit after a quiet period of wardrobe changes. The
 * job is enqueued (and rescheduled) by enqueueWardrobeOutfitAnnouncement and
 * fires once the debounce window has elapsed without further activity.
 *
 * The announcement is visible to every participant in the chat
 * (participantId: null, systemSender: 'aurora') and replaces the old manual
 * "Notify" composer button.
 */

import { randomUUID } from 'node:crypto';
import { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/errors';
import { describeOutfit } from '@/lib/wardrobe/outfit-description';
import type { MessageEvent } from '@/lib/schemas/types';
import type { WardrobeOutfitAnnouncementPayload } from '../queue-service';

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
  const itemsById = new Map(equippedItems.map(i => [i.id, i]));
  const titleFor = (slotId: string | null): string | null => {
    if (!slotId) return null;
    return itemsById.get(slotId)?.title ?? null;
  };

  const outfitText = describeOutfit({
    top: titleFor(slots.top),
    bottom: titleFor(slots.bottom),
    footwear: titleFor(slots.footwear),
    accessories: titleFor(slots.accessories),
  });

  const character = await repos.characters.findById(characterId);
  const charName = character?.name ?? 'A character';

  const content =
    `Aurora notes that ${charName}'s wardrobe has been duly attended to. ` +
    `${charName} is presently turned out as follows:\n\n${outfitText}`;

  const message: MessageEvent = {
    type: 'message',
    id: randomUUID(),
    role: 'ASSISTANT',
    content,
    attachments: [],
    createdAt: new Date().toISOString(),
    participantId: null,
    systemSender: 'aurora',
  };

  try {
    await repos.chats.addMessage(chatId, message);
    logger.info('[WardrobeAnnouncement] Announcement posted', {
      context: 'background-jobs.wardrobe-announcement',
      chatId,
      characterId,
      messageId: message.id,
    });
  } catch (error) {
    logger.error('[WardrobeAnnouncement] Failed to post announcement', {
      context: 'background-jobs.wardrobe-announcement',
      chatId,
      characterId,
      error: getErrorMessage(error),
    }, error as Error);
    throw error;
  }
}
