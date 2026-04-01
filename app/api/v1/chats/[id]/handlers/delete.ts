/**
 * Chats API v1 - DELETE Handler
 *
 * DELETE /api/v1/chats/[id] - Delete a chat
 */

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { notFound, serverError } from '@/lib/api/responses';
import type { AuthenticatedContext } from '@/lib/api/middleware';

/**
 * DELETE handler for removing a chat
 */
export async function handleDelete(
  ctx: AuthenticatedContext,
  chatId: string
): Promise<NextResponse> {
  const { user, repos } = ctx;

  try {

    const existingChat = await repos.chats.findById(chatId);
    if (!existingChat || existingChat.userId !== user.id) {
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
