/**
 * Chats API v1 - State Actions
 *
 * GET /api/v1/chats/[id]?action=get-state - Get chat state (merged with project)
 * PUT /api/v1/chats/[id]?action=set-state - Set chat state
 * DELETE /api/v1/chats/[id]?action=reset-state - Reset chat state to empty
 */

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { serverError, notFound } from '@/lib/api/responses';
import type { AuthenticatedContext } from '@/lib/api/middleware';
import { createResetStateHandler, createSetStateHandler } from '@/lib/api/state-handlers';

const STATE_CFG = {
  entityName: 'Chat',
  idLogKey: 'chatId',
  selectRepo: (repos: AuthenticatedContext['repos']) => repos.chats,
  useOwnershipCheck: false,
} as const;

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
    if (!chat) {
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

export const handleSetState = createSetStateHandler(STATE_CFG);
export const handleResetState = createResetStateHandler(STATE_CFG);
