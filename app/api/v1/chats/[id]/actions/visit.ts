/**
 * Chats API v1 - Visit Action
 *
 * POST /api/v1/chats/[id]?action=visit
 *
 * The housekeeping a chat needs when the operator opens it, which the default
 * GET used to do as a side effect of reading. The Salon posts this before each
 * full read of the chat, so anything it announces is in that read:
 *
 * - re-enqueue embeddings for conversation chunks that lost theirs (an outage
 *   mid-render, a died job) — fire-and-forget, debounced and deduped inside;
 * - close terminal sessions whose PTYs a restart lost, with their
 *   announcements;
 * - announce letters addressed to the operator's own character(s), which no
 *   LLM turn ever checks for.
 *
 * Each step is idempotent and warn-only, so a visit never fails the Salon.
 */

import { NextResponse } from 'next/server';
import { successResponse } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { maybeEnqueueColdChunkReembed } from '@/lib/scriptorium/cold-chunk-reembed';
import { reconcileTerminalSessionsForChat } from '@/lib/terminal/reconcile';
import { surfaceOperatorMailForChat } from '@/lib/post-office/surface-operator-mail';
import type { RequestContext } from '@/lib/api/middleware';
import type { ChatMetadata } from '@/lib/schemas/types';

export async function handleVisit(
  chatId: string,
  chat: ChatMetadata,
  { user }: RequestContext,
): Promise<NextResponse> {
  maybeEnqueueColdChunkReembed(user.id, chatId).catch((error) => {
    logger.warn('[Chats v1] Cold-chunk re-embed check failed — continuing', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  await reconcileTerminalSessionsForChat(chatId);
  await surfaceOperatorMailForChat(chatId, chat.participants);

  logger.debug('[Chats v1] Chat visited', { chatId });
  return successResponse({ visited: true });
}
