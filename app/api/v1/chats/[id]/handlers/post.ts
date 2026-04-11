/**
 * Chats API v1 - POST Handler
 *
 * POST /api/v1/chats/[id]?action=... - Action dispatch
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActionParam, isValidAction } from '@/lib/api/middleware/actions';
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
  handleRunTool,
  handleToggleAgentMode,
  handleRegenerateBackground,
  handleReclassifyDanger,
  handleEquipSlot,
  handleToggleAvatarGeneration,
  handleRegenerateAvatar,
  handleRenderConversation,
} from '../actions';
import type { AuthenticatedContext } from '@/lib/api/middleware';

const CHAT_POST_ACTIONS = [
  'regenerate-title',
  'add-tag',
  'remove-tag',
  'impersonate',
  'stop-impersonate',
  'set-active-speaker',
  'turn',
  'add-participant',
  'update-participant',
  'remove-participant',
  'bulk-reattribute',
  'set-avatar',
  'remove-avatar',
  'add-tool-result',
  'queue-memories',
  'update-tool-settings',
  'rng',
  'run-tool',
  'toggle-agent-mode',
  'regenerate-background',
  'reclassify-danger',
  'equip',
  'toggle-avatar-generation',
  'regenerate-avatar',
  'render-conversation',
] as const;

type ChatPostAction = typeof CHAT_POST_ACTIONS[number];

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
  if (!chat) {
    return notFound('Chat');
  }

  if (!isValidAction(action, CHAT_POST_ACTIONS)) {
    return badRequest(`Unknown action: ${action}. Available actions: ${CHAT_POST_ACTIONS.join(', ')}`);
  }

  const actionHandlers: Record<ChatPostAction, () => Promise<NextResponse>> = {
    'regenerate-title': () => handleRegenerateTitle(chatId, chat, ctx),
    'add-tag': () => handleAddTag(req, chatId, ctx),
    'remove-tag': () => handleRemoveTag(req, chatId, ctx),
    impersonate: () => handleImpersonate(req, chatId, chat, ctx),
    'stop-impersonate': () => handleStopImpersonate(req, chatId, chat, ctx),
    'set-active-speaker': () => handleSetActiveSpeaker(req, chatId, chat, ctx),
    turn: () => handleTurnAction(req, chatId, chat, ctx),
    'add-participant': () => handleAddParticipantAction(req, chatId, chat, ctx),
    'update-participant': () => handleUpdateParticipantAction(req, chatId, ctx),
    'remove-participant': () => handleRemoveParticipantAction(req, chatId, chat, ctx),
    'bulk-reattribute': () => handleBulkReattribute(req, chatId, chat, ctx),
    'set-avatar': () => handleSetAvatar(req, chatId, ctx),
    'remove-avatar': () => handleRemoveAvatar(req, chatId, ctx),
    'add-tool-result': () => handleAddToolResult(req, chatId, ctx),
    'queue-memories': () => handleQueueMemories(req, chatId, chat, ctx),
    'update-tool-settings': () => handleUpdateToolSettings(req, chatId, ctx),
    rng: () => handleRng(req, chatId, ctx),
    'run-tool': () => handleRunTool(req, chatId, ctx),
    'toggle-agent-mode': () => handleToggleAgentMode(req, chatId, ctx),
    'regenerate-background': () => handleRegenerateBackground(chatId, chat, ctx),
    'reclassify-danger': () => handleReclassifyDanger(chatId, chat, ctx),
    equip: () => handleEquipSlot(req, chatId, ctx),
    'toggle-avatar-generation': () => handleToggleAvatarGeneration(chatId, ctx),
    'regenerate-avatar': () => handleRegenerateAvatar(req, chatId, ctx),
    'render-conversation': () => handleRenderConversation(chatId, ctx),
  };

  return actionHandlers[action]();
}
