/**
 * Writer for Aurora chat whispers (wardrobe / appearance).
 *
 * Aurora is the personified wardrobe system. When a character's outfit is
 * established at chat-start or changes mid-chat, Aurora narrates it into the
 * transcript so both the user and the LLM see the same source of truth. This
 * replaces the per-turn `## Current Outfit`, `## Available Wardrobe`, and
 * `## ⚠️ Outfit Change Notice` blocks that previously lived in the system
 * prompt (Phase D of the system-prompt refactor).
 *
 * Aurora whispers do not need the dual persona/LLM voicing pattern that
 * Commonplace Book recall does — the persona-voiced body is acceptable input
 * for the LLM. For opaque (`systemTransparency=false`) characters the
 * `systemSender` attribution is stripped at context-build time but the body
 * survives, so the content still reaches them as a generic assistant line.
 *
 * Errors never propagate — wardrobe operations must never fail because an
 * announcement couldn't be written.
 */

import { randomUUID } from 'node:crypto';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/errors';
import { describeOutfit, type OutfitSlotValues } from '@/lib/wardrobe/outfit-description';
import type { MessageEvent } from '@/lib/schemas/types';

export interface AvailableWardrobeItem {
  title: string;
}

interface BuildContentParams {
  characterName: string;
  outfit: OutfitSlotValues;
  availableItems?: AvailableWardrobeItem[];
}

/**
 * Render a list of non-equipped wardrobe items, capped at a sensible length.
 * Returns null when there is nothing to render.
 */
function renderAvailableWardrobe(items: AvailableWardrobeItem[] | undefined): string | null {
  if (!items || items.length === 0) return null;
  const display = items.slice(0, 15);
  const lines = display.map((item) => `- ${item.title}`);
  let section = lines.join('\n');
  if (items.length > 15) {
    section += `\n(and ${items.length - 15} more — call list_wardrobe to browse the full register)`;
  }
  return section;
}

/**
 * Opening-of-chat outfit announcement. Establishes how a character is dressed
 * before the first character speaks. Includes the available wardrobe so the
 * LLM has the full picture once and need not call `list_wardrobe` immediately.
 */
export function buildOpeningOutfitContent(params: BuildContentParams): string {
  const { characterName, outfit, availableItems } = params;
  const outfitText = describeOutfit(outfit);
  const lines: string[] = [
    `*Aurora regards ${characterName} and pronounces upon their attire —*`,
    '',
    outfitText.trimEnd(),
  ];
  const wardrobeBlock = renderAvailableWardrobe(availableItems);
  if (wardrobeBlock) {
    lines.push('');
    lines.push(`*Aurora notes the rest of ${characterName}'s wardrobe is also at hand:*`);
    lines.push('');
    lines.push(wardrobeBlock);
  }
  return lines.join('\n');
}

/**
 * Mid-chat outfit-change announcement. Fires immediately when a character
 * equips or unequips an item via the sidebar. Replaces the per-turn
 * `pendingOutfitNotifications` flow.
 */
export function buildOutfitChangeContent(params: BuildContentParams): string {
  const { characterName, outfit, availableItems } = params;
  const outfitText = describeOutfit(outfit);
  const lines: string[] = [
    `*Aurora marks an alteration to ${characterName}'s attire. They are now turned out as follows —*`,
    '',
    outfitText.trimEnd(),
  ];
  const wardrobeBlock = renderAvailableWardrobe(availableItems);
  if (wardrobeBlock) {
    lines.push('');
    lines.push(`*The remainder of ${characterName}'s wardrobe stands ready:*`);
    lines.push('');
    lines.push(wardrobeBlock);
  }
  return lines.join('\n');
}

interface PostParams {
  chatId: string;
  content: string;
  /** Short label for logs — e.g. 'opening-outfit', 'outfit-change'. */
  kind: string;
  /** Optional whisper targeting. Aurora outfit announcements are public by default. */
  targetParticipantIds?: string[] | null;
}

async function postAuroraMessage(params: PostParams): Promise<MessageEvent | null> {
  const { chatId, content, kind, targetParticipantIds } = params;

  if (!content || content.trim().length === 0) {
    logger.debug('[AuroraNotification] Empty content, skipping', {
      context: 'aurora-notifications',
      chatId,
      kind,
    });
    return null;
  }

  try {
    const repos = getRepositories();
    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      logger.debug('[AuroraNotification] Chat not found, skipping', {
        context: 'aurora-notifications',
        chatId,
        kind,
      });
      return null;
    }

    const message: MessageEvent = {
      type: 'message',
      id: randomUUID(),
      role: 'ASSISTANT',
      content,
      attachments: [],
      createdAt: new Date().toISOString(),
      participantId: null,
      systemSender: 'aurora',
      targetParticipantIds: targetParticipantIds && targetParticipantIds.length > 0 ? targetParticipantIds : null,
    };

    await repos.chats.addMessage(chatId, message);

    logger.info('[AuroraNotification] Whisper posted', {
      context: 'aurora-notifications',
      chatId,
      messageId: message.id,
      kind,
      targetParticipantIds: targetParticipantIds ?? null,
    });

    return message;
  } catch (error) {
    logger.error('[AuroraNotification] Failed to post whisper', {
      context: 'aurora-notifications',
      chatId,
      kind,
      error: getErrorMessage(error),
    }, error as Error);
    return null;
  }
}

export interface OpeningOutfitAnnouncement {
  chatId: string;
  characterName: string;
  outfit: OutfitSlotValues;
  availableItems?: AvailableWardrobeItem[];
}

export async function postOpeningOutfitWhisper(
  params: OpeningOutfitAnnouncement,
): Promise<MessageEvent | null> {
  return postAuroraMessage({
    chatId: params.chatId,
    content: buildOpeningOutfitContent(params),
    kind: 'opening-outfit',
  });
}

export interface OutfitChangeAnnouncement {
  chatId: string;
  characterName: string;
  outfit: OutfitSlotValues;
  availableItems?: AvailableWardrobeItem[];
}

export async function postOutfitChangeWhisper(
  params: OutfitChangeAnnouncement,
): Promise<MessageEvent | null> {
  return postAuroraMessage({
    chatId: params.chatId,
    content: buildOutfitChangeContent(params),
    kind: 'outfit-change',
  });
}

