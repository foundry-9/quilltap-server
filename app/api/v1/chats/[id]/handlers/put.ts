/**
 * Chats API v1 - PUT Handler
 *
 * PUT /api/v1/chats/[id] - Update a chat
 * PUT /api/v1/chats/[id]?action=set-state - Set chat state
 */

import { NextRequest, NextResponse } from 'next/server';
import { dispatchAction } from '@/lib/api/middleware/actions';
import { enrichParticipantDetail } from '@/lib/services/chat-enrichment.service';
import { logger } from '@/lib/logger';
import { notFound, badRequest, serverError, errorResponse } from '@/lib/api/responses';
import { chatUpdateRequestSchema } from '../schemas';
import { processChatUpdates } from '../helpers';
import { handleSetState } from '../actions';
import type { RequestContext } from '@/lib/api/middleware';

/**
 * PUT handler for updating a chat
 */
export async function handlePut(
  req: NextRequest,
  ctx: RequestContext,
  chatId: string
): Promise<NextResponse> {
  return dispatchAction(
    req,
    { 'set-state': () => handleSetState(req, chatId, ctx) },
    () => handleUpdateChat(req, chatId, ctx)
  );
}

async function handleUpdateChat(
  req: NextRequest,
  chatId: string,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  const existingChat = await repos.chats.findById(chatId);
  if (!existingChat) {
    return notFound('Chat');
  }

  const body = await req.json();
  const validatedData = chatUpdateRequestSchema.parse(body);

  const result = await processChatUpdates(chatId, existingChat, validatedData, user.id, repos);

  if ('error' in result) {
    if (result.status === 404) {
      return errorResponse(result.error, 404);
    } else if (result.status === 400) {
      return badRequest(result.error);
    }
    return serverError(result.error);
  }

  const enrichedParticipants = await Promise.all(
    result.chat.participants.map((p) => enrichParticipantDetail(p, repos, chatId))
  );

  logger.info('[Chats v1] Chat updated', { chatId });

  return NextResponse.json({
    chat: { ...result.chat, participants: enrichedParticipants },
  });
}
