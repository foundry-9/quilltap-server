/**
 * Chats API v1 - Absent-character mentions
 *
 * GET /api/v1/chats/[id]?action=absent-mentions — for each workspace character
 * named in the chat but not in it, the message that first names them, the
 * name as written there, and their card.
 *
 * Drives the Salon's name chips: the first mention gets a chip, and hovering
 * it shows the card — the same particulars the model gets in its referent
 * ledger (`lib/chat/absent-mentions.ts`).
 */

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { notFound, successResponse } from '@/lib/api/responses';
import type { RequestContext } from '@/lib/api/middleware';
import { findAbsentMentions, presenceOf } from '@/lib/chat/absent-mentions';
import { resolveUserIdentity } from '@/lib/services/chat-message/user-identity-resolver.service';

/** GET ?action=absent-mentions */
export async function handleGetAbsentMentions(chatId: string, { user, repos }: RequestContext): Promise<NextResponse> {
  const chat = await repos.chats.findById(chatId);
  if (!chat) return notFound('Chat');

  const [messages, candidates, persona] = await Promise.all([
    repos.chats.getMessages(chatId),
    repos.characters.findByUserId(user.id),
    resolveUserIdentity(repos, user.id, chat, chat.activeTypingParticipantId ?? null),
  ]);

  const mentions = findAbsentMentions({
    messages: messages as Parameters<typeof findAbsentMentions>[0]['messages'],
    candidates,
    isInRoom: presenceOf({ participants: chat.participants, chatType: chat.chatType, personaName: persona.name }),
    userCharacterName: persona.name,
  });

  logger.debug('[Chats v1] Read absent-character mentions', {
    chatId,
    mentions: mentions.length,
    context: 'absent-mentions',
  });
  return successResponse({ mentions });
}
