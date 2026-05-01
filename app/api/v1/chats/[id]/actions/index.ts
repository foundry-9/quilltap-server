/**
 * Chats API v1 - Actions Index
 *
 * Re-exports all action handlers
 */

export { handleAddTag, handleRemoveTag } from './tags';
export { handleRegenerateTitle } from './title';
export {
  handleImpersonate,
  handleStopImpersonate,
  handleSetActiveSpeaker,
  handleAddParticipantAction,
  handleUpdateParticipantAction,
  handleRemoveParticipantAction,
} from './participants';
export { handleTurnAction } from './turn';
export { handleGetAvatars, handleSetAvatar, handleRemoveAvatar } from './avatars';
export { handleBulkReattribute } from './bulk';
export { handleAddToolResult, handleUpdateToolSettings } from './tools';
export { handleQueueMemories, handleExtractMemoriesDryRun } from './memories';
export { handleRng } from './rng';
export { handleRunTool } from './run-tool';
export { handleGetState, handleSetState, handleResetState } from './state';
export { handleToggleAgentMode } from './agent-mode';
export { handleRegenerateBackground } from './story-background';
export { handleReclassifyDanger } from './danger-classification';
export { handleGetOutfit, handleEquipSlot } from './outfit';
export { handleToggleAvatarGeneration } from './toggle-avatar-generation';
export { handleRegenerateAvatar } from './regenerate-avatar';
export { handleRenderConversation } from './render-conversation';
export {
  handleActiveDocument,
  handleRecentDocuments,
  handleOpenDocument,
  handleCloseDocument,
  handleReadDocument,
  handleWriteDocument,
  handleRenameDocument,
  handleDeleteDocument,
} from './documents';
