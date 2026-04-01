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
  projectId: z.string().uuid().nullish(),
});

export const updateParticipantSchema = z.object({
  participantId: z.string().uuid(),
  connectionProfileId: z.string().uuid().optional(),
  imageProfileId: z.string().uuid().nullish(),
  systemPromptOverride: z.string().nullish(),
  displayOrder: z.number().optional(),
  isActive: z.boolean().optional(),
  controlledBy: z.enum(['llm', 'user']).optional(),
  hasHistoryAccess: z.boolean().optional(),
  joinScenario: z.string().nullish(),
});

export const addParticipantSchema = z.object({
  type: z.literal('CHARACTER'),
  characterId: z.string().uuid(),
  connectionProfileId: z.string().uuid().optional(),
  imageProfileId: z.string().uuid().nullish(),
  systemPromptOverride: z.string().nullish(),
  displayOrder: z.number().optional(),
  hasHistoryAccess: z.boolean().optional(),
  joinScenario: z.string().nullish(),
  controlledBy: z.enum(['llm', 'user']).optional(),
});

export const removeParticipantSchema = z.object({
  participantId: z.string().uuid(),
});

export const chatUpdateRequestSchema = z.object({
  chat: updateChatSchema.optional(),
  updateParticipant: updateParticipantSchema.optional(),
  addParticipant: addParticipantSchema.optional(),
  removeParticipantId: z.string().uuid().optional(),
  roleplayTemplateId: z.string().nullish(),
});

export const addTagSchema = z.object({
  tagId: z.string().uuid(),
});

export const removeTagSchema = z.object({
  tagId: z.string().uuid(),
});

export const impersonateSchema = z.object({
  participantId: z.string().uuid(),
});

export const stopImpersonateSchema = z.object({
  participantId: z.string().uuid(),
  newConnectionProfileId: z.string().uuid().optional(),
});

export const setActiveSpeakerSchema = z.object({
  participantId: z.string().uuid(),
});

export const turnActionSchema = z.object({
  action: z.enum(['nudge', 'queue', 'dequeue']),
  participantId: z.string().uuid(),
});

export const persistTurnSchema = z.object({
  lastTurnParticipantId: z.string().uuid().nullable(),
});

export const bulkReattributeSchema = z.object({
  sourceParticipantId: z.string().uuid().nullable(),
  targetParticipantId: z.string().uuid(),
  roleFilter: z.enum(['ASSISTANT', 'USER', 'both']).default('both'),
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
  initiatedBy: z.enum(['user', 'character']).default('user'),
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
