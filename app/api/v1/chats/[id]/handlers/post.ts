/**
 * Chats API v1 - POST Handler
 *
 * POST /api/v1/chats/[id]?action=... - Action dispatch
 */

import { handleOpenChat } from '../actions/open';
import { handleVisit } from '../actions/visit';
import { TURN_ACTION_KINDS } from '../actions/turn';
import { deprecatedPath } from '@/lib/api/deprecated-path';
import { NextRequest, NextResponse } from 'next/server';
import { dispatchAction } from '@/lib/api/middleware/actions';
import { notFound } from '@/lib/api/responses';
import {
  handleAddTag,
  handleRemoveTag,
  handleRegenerateTitle,
  handleRebuildSummary,
  handleImpersonate,
  handleSetActiveSpeaker,
  handleAddParticipantAction,
  handleUpdateParticipantAction,
  handleRemoveParticipantAction,
  handleRebuildSystemPromptAction,
  handleTurnAction,
  handleStopTurn,
  handleRaiseHand,
  handleSetAvatar,
  handleRemoveAvatar,
  handleBulkReattribute,
  handleAddToolResult,
  handleUpdateToolSettings,
  handleQueueMemories,
  handleExtractMemoriesDryRun,
  handleRecallReplay,
  handleRng,
  handleRunTool,
  handleToggleAgentMode,
  handleRegenerateBackground,
  handleRetryImageUncensored,
  handleReclassifyDanger,
  handleEquipSlot,
  handleWardrobeRollback,
  handleInventoryEquip,
  handleInventoryResetDefaults,
  handleToggleAvatarGeneration,
  handleRegenerateAvatar,
  handleRenderConversation,
  handleOpenDocuments,
  handleRecentDocuments,
  handleOpenDocument,
  handleCloseDocument,
  handleReadDocument,
  handleResolveDocument,
  handleWriteDocument,
  handleRenameDocument,
  handleDeleteDocument,
  handleInsertAnnouncement,
  handleInform,
  handleCancelInform,
  handleAnnouncementPreview,
  handleImpersonationVoicePreview,
  handleSendMail,
  handleMergeConversation,
  handleSetScenario,
  handleSaveGalleryImage,
  handleStorytellerRunAction,
  handleStorytellerAsk,
  handleStorytellerLie,
} from '../actions';
import type { RequestContext } from '@/lib/api/middleware';

/**
 * POST handler with action dispatch
 */
export async function handlePost(
  req: NextRequest,
  ctx: RequestContext,
  chatId: string
): Promise<NextResponse> {
  const { repos } = ctx;

  // Verify ownership first
  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return notFound('Chat');
  }

  return dispatchAction(req, {
    visit: () => handleVisit(chatId, chat, ctx),
    'regenerate-title': () => handleRegenerateTitle(chatId, chat, ctx),
    'rebuild-summary': () => handleRebuildSummary(chatId, chat, ctx),
    'add-tag': () => handleAddTag(req, chatId, ctx),
    'remove-tag': () => handleRemoveTag(req, chatId, ctx),
    impersonate: () => handleImpersonate(req, chatId, chat, ctx),
    'set-active-speaker': () => handleSetActiveSpeaker(req, chatId, chat, ctx),
    ...Object.fromEntries(
      Object.entries(TURN_ACTION_KINDS).map(([action, kind]) => [action, () => handleTurnAction(req, chatId, chat, ctx, kind)]),
    ),
    // Deprecated: the action named in the body. Answers for one release.
    turn: deprecatedPath(
      'POST /api/v1/chats/[id]?action=turn',
      '/api/v1/chats/[id]?action=turn-nudge|turn-queue|turn-dequeue|turn-query|turn-skip-user',
      () => handleTurnAction(req, chatId, chat, ctx),
    ),
    'stop-turn': () => handleStopTurn(chatId, chat, ctx),
    'raise-hand': () => handleRaiseHand(req, chatId),
    'add-participant': () => handleAddParticipantAction(req, chatId, chat, ctx),
    'update-participant': () => handleUpdateParticipantAction(req, chatId, ctx),
    'remove-participant': () => handleRemoveParticipantAction(req, chatId, chat, ctx),
    'rebuild-system-prompt': () => handleRebuildSystemPromptAction(req, chatId, ctx),
    'bulk-reattribute': () => handleBulkReattribute(req, chatId, chat, ctx),
    'set-avatar': () => handleSetAvatar(req, chatId, ctx),
    'remove-avatar': () => handleRemoveAvatar(req, chatId, ctx),
    'add-tool-result': () => handleAddToolResult(req, chatId, ctx),
    'queue-memories': () => handleQueueMemories(req, chatId, chat, ctx),
    'extract-memories-dry-run': () => handleExtractMemoriesDryRun(req, chatId, chat, ctx),
    'recall-replay': () => handleRecallReplay(req, chatId, chat, ctx),
    'update-tool-settings': () => handleUpdateToolSettings(req, chatId, ctx),
    rng: () => handleRng(req, chatId, ctx),
    'run-tool': () => handleRunTool(req, chatId, ctx),
    'toggle-agent-mode': () => handleToggleAgentMode(req, chatId, ctx),
    'regenerate-background': () => handleRegenerateBackground(chatId, chat, ctx),
    'retry-image-uncensored': () => handleRetryImageUncensored(req, chatId, chat, ctx),
    'reclassify-danger': () => handleReclassifyDanger(chatId, chat, ctx),
    equip: () => handleEquipSlot(req, chatId, ctx),
    'wardrobe-rollback': () => handleWardrobeRollback(req, chatId, ctx),
    'inventory-equip': () => handleInventoryEquip(req, chatId, ctx, 'equip'),
    'inventory-unequip': () => handleInventoryEquip(req, chatId, ctx, 'unequip'),
    'inventory-reset-defaults': () => handleInventoryResetDefaults(req, chatId, ctx),
    'toggle-avatar-generation': () => handleToggleAvatarGeneration(chatId, ctx),
    'regenerate-avatar': () => handleRegenerateAvatar(req, chatId, ctx),
    'render-conversation': () => handleRenderConversation(chatId, ctx),
    'open-documents': () => handleOpenDocuments(chatId, ctx),
    'recent-documents': () => handleRecentDocuments(chatId, ctx),
    'open-document': () => handleOpenDocument(req, chatId, ctx),
    'close-document': () => handleCloseDocument(req, chatId, ctx),
    'read-document': () => handleReadDocument(req, chatId, ctx),
    'resolve-document': () => handleResolveDocument(req, chatId, ctx),
    'write-document': () => handleWriteDocument(req, chatId, ctx),
    'rename-document': () => handleRenameDocument(req, chatId, ctx),
    'delete-document': () => handleDeleteDocument(req, chatId, ctx),
    announcement: () => handleInsertAnnouncement(req, chatId, ctx),
    inform: () => handleInform(req, chatId, ctx),
    'cancel-inform': () => handleCancelInform(req, chatId, ctx),
    'announcement-preview': () => handleAnnouncementPreview(req, chatId, ctx),
    'impersonation-voice-preview': () => handleImpersonationVoicePreview(req, chatId, chat, ctx),
    'send-mail': () => handleSendMail(req, chatId, chat, ctx),
    'merge-conversation': () => handleMergeConversation(req, chatId, chat, ctx),
    open: () => handleOpenChat(chatId, ctx),
    scenario: () => handleSetScenario(req, chatId, ctx),
    'save-image': () => handleSaveGalleryImage(req, chatId, ctx),
    'storyteller-run': () => handleStorytellerRunAction(req, chatId, ctx),
    'storyteller-ask': () => handleStorytellerAsk(req, chatId, ctx),
    'storyteller-lie': () => handleStorytellerLie(req, chatId),
  });
}
