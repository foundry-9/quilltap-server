/**
 * Chat Message API v1 - Individual Message Endpoint
 *
 * POST /api/v1/chats/[id]/messages/[messageId]?action=override-danger-flag - Override danger flags
 */

import { NextRequest } from 'next/server';
import { createAuthenticatedParamsHandler, type AuthenticatedContext } from '@/lib/api/middleware';
import { withActionDispatch } from '@/lib/api/middleware/actions';
import { logger } from '@/lib/logger';
import { notFound, successResponse, serverError } from '@/lib/api/responses';

/**
 * Handle overriding danger flags on a message
 * Sets all dangerFlags entries to userOverridden: true
 */
async function handleOverrideDangerFlag(
  _req: NextRequest,
  { user, repos }: AuthenticatedContext,
  { id, messageId }: { id: string; messageId: string }
) {
  try {
    // Verify chat ownership
    const chat = await repos.chats.findById(id);
    if (!chat || chat.userId !== user.id) {
      return notFound('Chat');
    }

    // Find the message
    const messages = await repos.chats.getMessages(id);
    const message = messages.find((m: { id: string }) => m.id === messageId);
    if (!message) {
      return notFound('Message');
    }

    // Only message events can have danger flags
    if (message.type !== 'message') {
      return notFound('Message');
    }

    // Override all danger flags
    const existingFlags = message.dangerFlags || [];
    const dangerFlags = existingFlags.map((flag) => ({
      ...flag,
      userOverridden: true,
    }));

    await repos.chats.updateMessage(id, messageId, { dangerFlags });

    logger.info('[DangerousContent] Danger flags overridden by user', {
      chatId: id,
      messageId,
      userId: user.id,
      flagCount: dangerFlags.length,
    });

    return successResponse({ overridden: true, flagCount: dangerFlags.length });
  } catch (error) {
    logger.error('[DangerousContent] Failed to override danger flags', {
      chatId: id,
      messageId,
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError('Failed to override danger flags');
  }
}

export const POST = createAuthenticatedParamsHandler<{ id: string; messageId: string }>(
  withActionDispatch({
    'override-danger-flag': handleOverrideDangerFlag,
  })
);
