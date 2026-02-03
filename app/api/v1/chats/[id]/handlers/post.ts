/**
 * Chats API v1 - POST Handler
 *
 * POST /api/v1/chats/[id]?action=... - Action dispatch
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActionParam } from '@/lib/api/middleware/actions';
import { notFound, badRequest } from '@/lib/api/responses';
import {
  handleAddTag,
  handleRemoveTag,
  handleRegenerateTitle,
  handleImpersonate,
  handleStopImpersonate,
  handleSetActiveSpeaker,
  handleAddParticipantAction,
  handleUpdateParticipantAction,
  handleRemoveParticipantAction,
  handleTurnAction,
  handleSetAvatar,
  handleRemoveAvatar,
  handleBulkReattribute,
  handleAddToolResult,
  handleUpdateToolSettings,
  handleQueueMemories,
  handleRng,
  handleToggleAgentMode,
  handleRegenerateBackground,
} from '../actions';
import type { AuthenticatedContext } from '@/lib/api/middleware';

/**
 * POST handler with action dispatch
 */
export async function handlePost(
  req: NextRequest,
  ctx: AuthenticatedContext,
  chatId: string
): Promise<NextResponse> {
  const { user, repos } = ctx;
  const action = getActionParam(req);

  // Verify ownership first
  const chat = await repos.chats.findById(chatId);
  if (!chat || chat.userId !== user.id) {
    return notFound('Chat');
  }

  switch (action) {
    case 'regenerate-title':
      return handleRegenerateTitle(chatId, chat, ctx);

    case 'add-tag':
      return handleAddTag(req, chatId, ctx);

    case 'remove-tag':
      return handleRemoveTag(req, chatId, ctx);

    case 'impersonate':
      return handleImpersonate(req, chatId, chat, ctx);

    case 'stop-impersonate':
      return handleStopImpersonate(req, chatId, chat, ctx);

    case 'set-active-speaker':
      return handleSetActiveSpeaker(req, chatId, chat, ctx);

    case 'turn':
      return handleTurnAction(req, chatId, chat, ctx);

    case 'add-participant':
      return handleAddParticipantAction(req, chatId, chat, ctx);

    case 'update-participant':
      return handleUpdateParticipantAction(req, chatId, ctx);

    case 'remove-participant':
      return handleRemoveParticipantAction(req, chatId, chat, ctx);

    case 'bulk-reattribute':
      return handleBulkReattribute(req, chatId, chat, ctx);

    case 'set-avatar':
      return handleSetAvatar(req, chatId, ctx);

    case 'remove-avatar':
      return handleRemoveAvatar(req, chatId, ctx);

    case 'add-tool-result':
      return handleAddToolResult(req, chatId, ctx);

    case 'queue-memories':
      return handleQueueMemories(req, chatId, chat, ctx);

    case 'update-tool-settings':
      return handleUpdateToolSettings(req, chatId, ctx);

    case 'rng':
      return handleRng(req, chatId, ctx);

    case 'toggle-agent-mode':
      return handleToggleAgentMode(req, chatId, ctx);

    case 'regenerate-background':
      return handleRegenerateBackground(chatId, chat, ctx);

    default:
      return badRequest(
        `Unknown action: ${action}. Available actions: regenerate-title, add-tag, remove-tag, impersonate, stop-impersonate, set-active-speaker, turn, add-participant, update-participant, remove-participant, bulk-reattribute, get-avatars, set-avatar, remove-avatar, add-tool-result, queue-memories, update-tool-settings, rng, toggle-agent-mode, regenerate-background`
      );
  }
}
