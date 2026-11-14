/**
 * Chats API v1 - Atlas mentions
 *
 * GET /api/v1/chats/[id]?action=atlas-mentions — for each Atlas entry the
 * chat's present cast can reach (the cast view), the message that first names
 * it — a spoken line or the Host's scenario row — the term as written there,
 * and its card (name, aliases, graphic prompt, knowledge, tier, picture).
 *
 * Drives the Salon's thing chips (`lib/atlas/mentions.ts`).
 */

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { notFound, successResponse } from '@/lib/api/responses';
import type { RequestContext } from '@/lib/api/middleware';
import { findAtlasMentions, type AtlasMentionMessage } from '@/lib/atlas/mentions';
import { loadCastAtlasView } from '@/lib/atlas/pool';

/** GET ?action=atlas-mentions */
export async function handleGetAtlasMentions(chatId: string, { user, repos }: RequestContext): Promise<NextResponse> {
  const chat = await repos.chats.findById(chatId);
  if (!chat) return notFound('Chat');

  const view = await loadCastAtlasView(repos, { chat });
  if (view.entries.length === 0) {
    logger.debug('[Chats v1] No Atlas entries in reach; no chips', { chatId, context: 'atlas' });
    return successResponse({ mentions: [] });
  }
  const [messages, people] = await Promise.all([
    repos.chats.getMessages(chatId),
    repos.characters.findByUserId(user.id),
  ]);
  const mentions = findAtlasMentions({
    messages: messages as AtlasMentionMessage[],
    entries: view.entries,
    people: people.map((c) => ({ name: c.name, aliases: c.aliases ?? [] })),
  });
  logger.debug('[Chats v1] Read Atlas mentions', { chatId, entries: view.entries.length, mentions: mentions.length, context: 'atlas' });
  return successResponse({ mentions });
}
