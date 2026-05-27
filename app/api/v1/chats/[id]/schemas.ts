/**
 * Chats API v1 - Zod Schemas
 *
 * Validation schemas for chat route requests
 */

import { z } from 'zod';
import { OutfitSelectionSchema } from '@/lib/schemas/wardrobe.types';

export const updateChatSchema = z.object({
  title: z.string().optional(),
  contextSummary: z.string().optional(),
  roleplayTemplateId: z.string().nullish(),
  isPaused: z.boolean().optional(),
  isManuallyRenamed: z.boolean().optional(),
  documentEditingMode: z.boolean().optional(),
  projectId: z.uuid().nullish(),
  imageProfileId: z.uuid().nullish(), // Chat-level image profile (shared by all participants)
  alertCharactersOfLanternImages: z.boolean().nullish(),
  allowCrossCharacterVaultReads: z.boolean().optional(),
  coreWhisperEnabled: z.boolean().nullish(),
  coreWhisperInterval: z.number().int().min(1).nullish(),
  // Layout state for the salon split panes
  documentMode: z.enum(['normal', 'split', 'focus']).optional(),
  dividerPosition: z.number().min(20).max(80).optional(),
  terminalMode: z.enum(['normal', 'split', 'focus']).optional(),
  activeTerminalSessionId: z.uuid().nullish(),
  rightPaneVerticalSplit: z.number().min(20).max(80).optional(),
});

export const updateParticipantSchema = z.object({
  participantId: z.uuid(),
  connectionProfileId: z.uuid().optional(),
  imageProfileId: z.uuid().nullish(),
  selectedSystemPromptId: z.uuid().nullish(),
  displayOrder: z.number().optional(),
  isActive: z.boolean().optional(),  // Keep for backward compat
  status: z.enum(['active', 'silent', 'absent', 'removed']).optional(),  // New preferred field
  controlledBy: z.enum(['llm', 'user']).optional(),
  hasHistoryAccess: z.boolean().optional(),
  joinScenario: z.string().nullish(),
  /**
   * Per-chat talkativeness override (0.1–1.0). Pass `null` to clear the
   * override and inherit from the character record again.
   */
  talkativeness: z.number().min(0.1).max(1.0).nullish(),
});

export const addParticipantSchema = z.object({
  type: z.literal('CHARACTER'),
  characterId: z.uuid(),
  connectionProfileId: z.uuid().optional(),
  imageProfileId: z.uuid().nullish(),
  displayOrder: z.number().optional(),
  hasHistoryAccess: z.boolean().optional(),
  joinScenario: z.string().nullish(),
  controlledBy: z.enum(['llm', 'user']).optional(),
  /**
   * Starting outfit selection for the added character. When omitted, the
   * server applies the character's default wardrobe (`mode: 'default'`).
   */
  outfitSelection: OutfitSelectionSchema.optional(),
});

export const removeParticipantSchema = z.object({
  participantId: z.uuid(),
});

export const chatUpdateRequestSchema = z.object({
  chat: updateChatSchema.optional(),
  updateParticipant: updateParticipantSchema.optional(),
  addParticipant: addParticipantSchema.optional(),
  removeParticipantId: z.uuid().optional(),
  roleplayTemplateId: z.string().nullish(),
  imageProfileId: z.uuid().nullish(), // Chat-level image profile (shortcut, same as chat.imageProfileId)
  /**
   * Tri-state per-chat Concierge mode set from the sidebar:
   *   - 'safe'    : moderation runs as usual, classifier may auto-flip → 'flagged'
   *   - 'flagged' : the chat is treated as dangerous (uncensored routing, etc.)
   *   - 'off'     : the Concierge is off-duty for this chat (no moderation)
   * The handler maps this onto chats.conciergeOverride + chats.isDangerousChat.
   */
  conciergeState: z.enum(['safe', 'flagged', 'off']).optional(),
});

export const addTagSchema = z.object({
  tagId: z.uuid(),
});

export const removeTagSchema = z.object({
  tagId: z.uuid(),
});

export const impersonateSchema = z.object({
  participantId: z.uuid(),
});

export const stopImpersonateSchema = z.object({
  participantId: z.uuid(),
  newConnectionProfileId: z.uuid().optional(),
});

export const setActiveSpeakerSchema = z.object({
  participantId: z.uuid(),
});

export const turnActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('nudge'), participantId: z.uuid() }),
  z.object({ action: z.literal('queue'), participantId: z.uuid() }),
  z.object({ action: z.literal('dequeue'), participantId: z.uuid() }),
  z.object({ action: z.literal('query') }),
  z.object({ action: z.literal('skipUserTurn'), participantId: z.uuid() }),
]);

export const persistTurnSchema = z.object({
  lastTurnParticipantId: z.uuid().nullable(),
});

export const bulkReattributeSchema = z.object({
  sourceParticipantId: z.uuid().nullable(),
  targetParticipantId: z.uuid(),
  roleFilter: z.enum(['ASSISTANT', 'USER', 'both']).prefault('both'),
});

export const avatarOverrideSchema = z.object({
  characterId: z.string(),
  imageId: z.string(),
});

export const removeAvatarSchema = z.object({
  characterId: z.string(),
});

export const toolResultSchema = z.object({
  tool: z.string(),
  initiatedBy: z.enum(['user', 'character']).prefault('user'),
  prompt: z.string().optional(),
  result: z.any().optional(),
  images: z.array(z.object({
    id: z.string(),
    filename: z.string(),
  })).optional(),
});

export const queueMemoriesSchema = z.object({
  characterId: z.string().optional(),
  characterName: z.string().optional(),
  messagePairs: z.array(z.object({
    userMessageId: z.string(),
    assistantMessageId: z.string(),
    userContent: z.string(),
    assistantContent: z.string(),
  })).optional(),
});

const STAFF_SENDER_ENUM = z.enum([
  'lantern',
  'aurora',
  'librarian',
  'concierge',
  'prospero',
  'host',
  'commonplaceBook',
  'ariel',
]);

export const insertAnnouncementSchema = z.object({
  contentMarkdown: z.string().min(1),
  sender: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('staff'), staffId: STAFF_SENDER_ENUM }),
    z.object({ kind: z.literal('character'), characterId: z.uuid() }),
    z.object({ kind: z.literal('custom'), displayName: z.string().min(1).max(120) }),
  ]),
});

export const insertAnnouncementPreviewSchema = z.object({
  seedMarkdown: z.string().min(1),
  characterId: z.uuid(),
  connectionProfileId: z.uuid(),
  systemPromptId: z.uuid().optional(),
});
