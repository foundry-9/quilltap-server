/**
 * Writer for Concierge chat notifications.
 *
 * When the gatekeeper classifies a chat as dangerous, this helper injects a
 * synthetic ASSISTANT-role chat message announcing the Concierge's quiet
 * intervention. Characters at the table see — through the avatar of the
 * Concierge, in discreet language — that the conversation has been marked
 * for handling by more appropriate providers.
 *
 * Errors never propagate — the danger-classification job must never fail
 * because an announcement couldn't be written.
 */

import { randomUUID } from 'node:crypto';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import type { MessageEvent } from '@/lib/schemas/types';

export interface ConciergeDangerAnnouncement {
  chatId: string;
}

export function buildDangerContent(): string {
  return (
    "The Concierge, with his customary discretion, has stepped quietly to the table. " +
    "He has arranged for the present conversation — and any adjunct errands it may occasion — " +
    "to be entrusted to a desk better appointed to subjects of its particular character. " +
    "No interruption is required; pray continue at your leisure."
  );
}

export async function postConciergeDangerAnnouncement(
  params: ConciergeDangerAnnouncement,
): Promise<MessageEvent | null> {
  const { chatId } = params;
  try {
    const repos = getRepositories();

    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      return null;
    }

    const messageId = randomUUID();
    const now = new Date().toISOString();
    const content = buildDangerContent();

    const message: MessageEvent = {
      type: 'message',
      id: messageId,
      role: 'ASSISTANT',
      content,
      attachments: [],
      createdAt: now,
      participantId: null,
      systemSender: 'concierge',
      systemKind: 'danger',
    };

    await repos.chats.addMessage(chatId, message);

    logger.info('[ConciergeNotification] Danger announcement posted', {
      context: 'concierge-notifications',
      chatId,
      messageId,
    });

    return message;
  } catch (error) {
    logger.error('[ConciergeNotification] Failed to post danger announcement', {
      context: 'concierge-notifications',
      chatId,
      error: getErrorMessage(error),
    }, error as Error);
    return null;
  }
}
