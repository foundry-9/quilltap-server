/**
 * Chats API v1 - DELETE Handler
 *
 * DELETE /api/v1/chats/[id] - Delete a chat
 * DELETE /api/v1/chats/[id]?action=reset-state - Reset chat state to empty
 * DELETE /api/v1/chats/[id]?action=stop-impersonate - Stop impersonating a participant
 */

import { NextRequest, NextResponse } from 'next/server';
import { dispatchAction } from '@/lib/api/middleware/actions';
import { logger } from '@/lib/logger';
import { notFound, serverError } from '@/lib/api/responses';
import { handleResetState, handleStopImpersonate } from '../actions';
import type { RequestContext } from '@/lib/api/middleware';

/**
 * DELETE handler for removing a chat
 */
export async function handleDelete(
  req: NextRequest,
  ctx: RequestContext,
  chatId: string
): Promise<NextResponse> {
  const { repos } = ctx;

  // The fallback deletes the whole chat, so an unknown action must be a 400
  // rather than falling through to it — `dispatchAction` guarantees that.
  return dispatchAction(
    req,
    {
      'reset-state': () => handleResetState(chatId, ctx),
      // DELETE is the semantically correct verb (the client already sends
      // DELETE); the handler needs the chat, so fetch it.
      'stop-impersonate': async () => {
        const chat = await repos.chats.findById(chatId);
        if (!chat) {
          return notFound('Chat');
        }
        return handleStopImpersonate(req, chatId, chat, ctx);
      },
    },
    () => handleDeleteChat(chatId, ctx)
  );
}

async function handleDeleteChat(chatId: string, { repos }: RequestContext): Promise<NextResponse> {
  try {
    const existingChat = await repos.chats.findById(chatId);
    if (!existingChat) {
      return notFound('Chat');
    }

    await repos.chats.delete(chatId);

    logger.info('[Chats v1] Chat deleted', { chatId });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('[Chats v1] Error deleting chat', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to delete chat');
  }
}
