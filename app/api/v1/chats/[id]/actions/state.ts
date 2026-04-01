/**
 * Chats API v1 - State Actions
 *
 * GET /api/v1/chats/[id]?action=get-state - Get chat state (merged with project)
 * PUT /api/v1/chats/[id]?action=set-state - Set chat state
 * DELETE /api/v1/chats/[id]?action=reset-state - Reset chat state to empty
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { validationError, serverError, notFound } from '@/lib/api/responses';
import type { AuthenticatedContext } from '@/lib/api/middleware';

/**
 * Schema for set-state request
 */
const setStateRequestSchema = z.object({
  state: z.record(z.string(), z.unknown()),
});

/**
 * Merge project state into chat state (chat overrides project)
 * Only merges top-level keys
 */
function mergeState(
  projectState: Record<string, unknown>,
  chatState: Record<string, unknown>
): Record<string, unknown> {
  return { ...projectState, ...chatState };
}

/**
 * Get chat state (optionally merged with project state)
 */
export async function handleGetState(
  chatId: string,
  { user, repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const chat = await repos.chats.findById(chatId);
    if (!chat || chat.userId !== user.id) {
      return notFound('Chat');
    }

    const chatState = (chat.state || {}) as Record<string, unknown>;

    // Get project state if chat belongs to a project
    let projectState: Record<string, unknown> = {};
    if (chat.projectId) {
      const project = await repos.projects.findById(chat.projectId);
      if (project && project.userId === user.id) {
        projectState = (project.state || {}) as Record<string, unknown>;
      }
    }

    // Return merged state (chat overrides project at top level)
    const mergedState = mergeState(projectState, chatState);

    return NextResponse.json({
      success: true,
      state: mergedState,
      chatState,
      projectState: Object.keys(projectState).length > 0 ? projectState : undefined,
      projectId: chat.projectId || undefined,
    });
  } catch (error) {
    logger.error('[Chats v1] Error getting state', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to get state');
  }
}

/**
 * Set chat state (replaces entire state object)
 */
export async function handleSetState(
  req: NextRequest,
  chatId: string,
  { user, repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const chat = await repos.chats.findById(chatId);
    if (!chat || chat.userId !== user.id) {
      return notFound('Chat');
    }

    const body = await req.json();
    const validated = setStateRequestSchema.parse(body);

    // Update state
    const updatedChat = await repos.chats.update(chatId, {
      state: validated.state,
    });

    logger.info('[Chats v1] State updated', {
      chatId,
      userId: user.id,
      stateKeys: Object.keys(validated.state),
    });

    return NextResponse.json({
      success: true,
      state: updatedChat?.state || validated.state,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }
    logger.error('[Chats v1] Error setting state', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to set state');
  }
}

/**
 * Reset chat state to empty object
 */
export async function handleResetState(
  chatId: string,
  { user, repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const chat = await repos.chats.findById(chatId);
    if (!chat || chat.userId !== user.id) {
      return notFound('Chat');
    }

    const previousState = (chat.state || {}) as Record<string, unknown>;

    // Reset to empty object
    await repos.chats.update(chatId, {
      state: {},
    });

    logger.info('[Chats v1] State reset', {
      chatId,
      userId: user.id,
    });

    return NextResponse.json({
      success: true,
      previousState,
    });
  } catch (error) {
    logger.error('[Chats v1] Error resetting state', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to reset state');
  }
}
