/**
 * Chats API v1 - Zod Schemas
 *
 * Validation schemas for chat route requests
 */

import { z } from 'zod';

export const updateChatSchema = z.object({
  title: z.string().optional(),
  contextSummary: z.string().optional(),
  roleplayTemplateId: z.string().nullish(),
  isPaused: z.boolean().optional(),
  isManuallyRenamed: z.boolean().optional(),
  documentEditingMode: z.boolean().optional(),
  projectId: z.uuid().nullish(),
  imageProfileId: z.uuid().nullish(), // Chat-level image profile (shared by all participants)
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
