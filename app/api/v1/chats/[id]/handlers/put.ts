/**
 * Chats API v1 - PUT Handler
 *
 * PUT /api/v1/chats/[id] - Update a chat
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { enrichParticipantDetail } from '@/lib/services/chat-enrichment.service';
import { logger } from '@/lib/logger';
import { notFound, badRequest, validationError, serverError } from '@/lib/api/responses';
import { chatUpdateRequestSchema } from '../schemas';
import { processChatUpdates } from '../helpers';
import type { AuthenticatedContext } from '@/lib/api/middleware';

/**
 * PUT handler for updating a chat
 */
export async function handlePut(
  req: NextRequest,
  ctx: AuthenticatedContext,
  chatId: string
): Promise<NextResponse> {
  const { user, repos } = ctx;

  try {

    const existingChat = await repos.chats.findById(chatId);
    if (!existingChat || existingChat.userId !== user.id) {
      return notFound('Chat');
    }

    const body = await req.json();
    const validatedData = chatUpdateRequestSchema.parse(body);

    const result = await processChatUpdates(chatId, existingChat, validatedData, user.id, repos);

    if ('error' in result) {
      if (result.status === 404) {
        return notFound('Resource');
      } else if (result.status === 400) {
        return badRequest(result.error);
      }
      return serverError(result.error);
    }

    const enrichedParticipants = await Promise.all(
      result.chat.participants.map((p) => enrichParticipantDetail(p, repos))
    );

    logger.info('[Chats v1] Chat updated', { chatId });

    return NextResponse.json({
      chat: { ...result.chat, participants: enrichedParticipants },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Chats v1] Error updating chat', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to update chat');
  }
}
