/**
 * Shell API v1 - Workspace Acknowledgement Endpoint
 *
 * POST /api/v1/shell/workspace-acknowledgement
 * Records user's acknowledgement of workspace security implications.
 */

import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { successResponse, badRequest, serverError, validationError } from '@/lib/api/responses';

// ============================================================================
// Schemas
// ============================================================================

const acknowledgeSchema = z.object({
  chatId: z.uuid(),
});

// ============================================================================
// POST Handler
// ============================================================================

export const POST = createAuthenticatedHandler(async (request, { user, repos }) => {
  try {
    const body = await request.json();
    const parsed = acknowledgeSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const { chatId } = parsed.data;

    // Verify chat exists and belongs to user
    const chat = await repos.chats.findById(chatId);
    if (!chat || chat.userId !== user.id) {
      return badRequest('Chat not found');
    }

    // Update chat state with acknowledgement
    const chatState = chat.state
      ? (typeof chat.state === 'string' ? JSON.parse(chat.state) : chat.state)
      : {};

    const newState = {
      ...chatState,
      workspaceWarningAcknowledged: true,
    };

    await repos.chats.update(chatId, { state: newState as Record<string, unknown> });

    logger.info('[Shell v1] Workspace acknowledgement recorded', {
      chatId,
      userId: user.id,
    });

    return successResponse({
      acknowledged: true,
      message: 'Workspace acknowledgement recorded',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }
    logger.error('[Shell v1] Error recording workspace acknowledgement', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to record workspace acknowledgement');
  }
});
