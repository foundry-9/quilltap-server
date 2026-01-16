/**
 * Chats API v1 - Individual Chat Endpoint
 *
 * GET /api/v1/chats/[id] - Get a specific chat
 * PUT /api/v1/chats/[id] - Update a chat
 * DELETE /api/v1/chats/[id] - Delete a chat
 * GET /api/v1/chats/[id]?action=export - Export chat (SillyTavern JSONL)
 * GET /api/v1/chats/[id]?action=cost - Get cost breakdown
 * GET /api/v1/chats/[id]?action=get-avatars - Get avatar overrides for chat
 * POST /api/v1/chats/[id]?action=regenerate-title - Regenerate chat title
 * POST /api/v1/chats/[id]?action=add-tag - Add tag
 * POST /api/v1/chats/[id]?action=remove-tag - Remove tag
 * POST /api/v1/chats/[id]?action=impersonate - Start impersonating
 * POST /api/v1/chats/[id]?action=stop-impersonate - Stop impersonating
 * POST /api/v1/chats/[id]?action=set-active-speaker - Set active typing participant
 * POST /api/v1/chats/[id]?action=turn - Turn action (nudge/queue/dequeue)
 * POST /api/v1/chats/[id]?action=add-participant - Add participant
 * POST /api/v1/chats/[id]?action=update-participant - Update participant
 * POST /api/v1/chats/[id]?action=remove-participant - Remove participant
 * POST /api/v1/chats/[id]?action=bulk-reattribute - Re-attribute multiple messages
 * POST /api/v1/chats/[id]?action=set-avatar - Set avatar override for character
 * POST /api/v1/chats/[id]?action=remove-avatar - Remove avatar override
 * POST /api/v1/chats/[id]?action=add-tool-result - Add tool result message
 * POST /api/v1/chats/[id]?action=queue-memories - Queue memory extraction jobs
 * PATCH /api/v1/chats/[id]?action=turn - Persist turn state (lastTurnParticipantId)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler, type AuthenticatedContext } from '@/lib/api/middleware';
import { getFilePath } from '@/lib/api/middleware/file-path';
import { getActionParam } from '@/lib/api/middleware/actions';
import { exportSTChatAsJSONL } from '@/lib/sillytavern/chat';
import { getCheapLLMProvider } from '@/lib/llm/cheap-llm';
import { titleChat, ChatMessage } from '@/lib/memory/cheap-llm-tasks';
import { getChatCostBreakdown, getDetailedChatCostBreakdown } from '@/lib/services/cost-estimation.service';
import {
  selectNextSpeaker,
  calculateTurnStateFromHistory,
  nudgeParticipant,
  addToQueue,
  removeFromQueue,
  getQueuePosition,
  getActiveCharacterParticipants,
  findUserParticipant,
  isMultiCharacterChat,
  getSelectionExplanation,
} from '@/lib/chat/turn-manager';
import { enrichParticipantDetail } from '@/lib/services/chat-enrichment.service';
import { deleteMemoryWithVector } from '@/lib/memory/memory-service';
import { enqueueMemoryExtractionBatch, ensureProcessorRunning, type MessagePair } from '@/lib/background-jobs';
import { getErrorMessage } from '@/lib/errors';
import { randomUUID } from 'node:crypto';
import type { ChatMetadata, ChatParticipantBase, MessageEvent, Character, ChatEvent } from '@/lib/schemas/types';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { notFound, forbidden, badRequest, serverError, validationError } from '@/lib/api/responses';

type Repos = RepositoryContainer;

// ============================================================================
// Schemas
// ============================================================================

const updateChatSchema = z.object({
  title: z.string().optional(),
  contextSummary: z.string().optional(),
  roleplayTemplateId: z.string().nullish(),
  isPaused: z.boolean().optional(),
  isManuallyRenamed: z.boolean().optional(),
  documentEditingMode: z.boolean().optional(),
  projectId: z.string().uuid().nullish(),
});

const updateParticipantSchema = z.object({
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

const addParticipantSchema = z.object({
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

const removeParticipantSchema = z.object({
  participantId: z.string().uuid(),
});

const chatUpdateRequestSchema = z.object({
  chat: updateChatSchema.optional(),
  updateParticipant: updateParticipantSchema.optional(),
  addParticipant: addParticipantSchema.optional(),
  removeParticipantId: z.string().uuid().optional(),
  roleplayTemplateId: z.string().nullish(),
});

const addTagSchema = z.object({
  tagId: z.string().uuid(),
});

const removeTagSchema = z.object({
  tagId: z.string().uuid(),
});

const impersonateSchema = z.object({
  participantId: z.string().uuid(),
});

const stopImpersonateSchema = z.object({
  participantId: z.string().uuid(),
  newConnectionProfileId: z.string().uuid().optional(),
});

const setActiveSpeakerSchema = z.object({
  participantId: z.string().uuid(),
});

const turnActionSchema = z.object({
  action: z.enum(['nudge', 'queue', 'dequeue']),
  participantId: z.string().uuid(),
});

const persistTurnSchema = z.object({
  lastTurnParticipantId: z.string().uuid().nullable(),
});

const bulkReattributeSchema = z.object({
  sourceParticipantId: z.string().uuid().nullable(),
  targetParticipantId: z.string().uuid(),
  roleFilter: z.enum(['ASSISTANT', 'USER', 'both']).default('both'),
});

const avatarOverrideSchema = z.object({
  characterId: z.string(),
  imageId: z.string(),
});

const removeAvatarSchema = z.object({
  characterId: z.string(),
});

const toolResultSchema = z.object({
  tool: z.string(),
  initiatedBy: z.enum(['user', 'character']).default('user'),
  prompt: z.string().optional(),
  result: z.any().optional(),
  images: z.array(z.object({
    id: z.string(),
    filename: z.string(),
  })).optional(),
});

const queueMemoriesSchema = z.object({
  characterId: z.string().optional(),
  characterName: z.string().optional(),
  messagePairs: z.array(z.object({
    userMessageId: z.string(),
    assistantMessageId: z.string(),
    userContent: z.string(),
    assistantContent: z.string(),
  })).optional(),
});

/**
 * Extended message pair with character info for multi-character support
 */
interface MessagePairWithCharacter extends MessagePair {
  characterId: string;
  characterName: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

async function getEnrichedCharacter(characterId: string, repos: Repos) {
  const charData = await repos.characters.findById(characterId);
  if (!charData) return null;

  let defaultImage = null;
  if (charData.defaultImageId) {
    const fileEntry = await repos.files.findById(charData.defaultImageId);
    if (fileEntry) {
      defaultImage = { id: fileEntry.id, filepath: getFilePath(fileEntry), url: null };
    }
  }

  return {
    id: charData.id,
    name: charData.name,
    title: charData.title,
    avatarUrl: charData.avatarUrl,
    talkativeness: charData.talkativeness ?? 0.5,
    defaultImageId: charData.defaultImageId,
    defaultImage,
    defaultConnectionProfileId: charData.defaultConnectionProfileId,
  };
}

async function getEnrichedConnectionProfile(profileId: string, repos: Repos) {
  const profile = await repos.connections.findById(profileId);
  if (!profile) return null;

  let apiKeyInfo = null;
  if (profile.apiKeyId) {
    const apiKey = await repos.connections.findApiKeyById(profile.apiKeyId);
    if (apiKey) {
      apiKeyInfo = { id: apiKey.id, provider: apiKey.provider, label: apiKey.label };
    }
  }

  return {
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    modelName: profile.modelName,
    apiKey: apiKeyInfo,
  };
}

async function enrichParticipant(participant: ChatParticipantBase, repos: Repos) {
  if (participant.type !== 'CHARACTER') {
    throw new Error('Only CHARACTER participants are supported');
  }

  const character = participant.characterId
    ? await getEnrichedCharacter(participant.characterId, repos)
    : null;

  const connectionProfile = participant.connectionProfileId
    ? await getEnrichedConnectionProfile(participant.connectionProfileId, repos)
    : null;

  return {
    id: participant.id,
    type: participant.type,
    controlledBy: participant.controlledBy || 'llm',
    characterId: participant.characterId,
    displayOrder: participant.displayOrder,
    isActive: participant.isActive,
    systemPromptOverride: participant.systemPromptOverride,
    hasHistoryAccess: participant.hasHistoryAccess,
    joinScenario: participant.joinScenario,
    character,
    connectionProfile,
    createdAt: participant.createdAt,
    updatedAt: participant.updatedAt,
  };
}

async function handleParticipantUpdate(
  chatId: string,
  data: z.infer<typeof updateParticipantSchema>,
  userId: string,
  repos: Repos
): Promise<{ chat: ChatMetadata } | { error: string; status: number }> {
  const { participantId, ...participantData } = data;

  if (participantData.connectionProfileId) {
    const profile = await repos.connections.findById(participantData.connectionProfileId);
    if (!profile || profile.userId !== userId) {
      return { error: 'Connection profile not found', status: 404 };
    }
  }

  if (participantData.imageProfileId) {
    const profile = await repos.imageProfiles.findById(participantData.imageProfileId);
    if (!profile || profile.userId !== userId) {
      return { error: 'Image profile not found', status: 404 };
    }
  }

  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return { error: 'Chat not found', status: 404 };
  }

  const result = await repos.chats.updateParticipant(chatId, participantId, participantData);
  if (!result) {
    return { error: 'Participant not found', status: 404 };
  }

  if (participantData.controlledBy !== undefined) {
    const currentImpersonating = chat.impersonatingParticipantIds || [];
    const isCurrentlyImpersonating = currentImpersonating.includes(participantId);

    if (participantData.controlledBy === 'user' && !isCurrentlyImpersonating) {
      logger.debug('[Chats v1] Adding participant to impersonation', { chatId, participantId });
      const newImpersonating = [...currentImpersonating, participantId];
      await repos.chats.update(chatId, {
        impersonatingParticipantIds: newImpersonating,
        ...(result.activeTypingParticipantId ? {} : { activeTypingParticipantId: participantId }),
      });
    } else if (participantData.controlledBy === 'llm' && isCurrentlyImpersonating) {
      logger.debug('[Chats v1] Removing participant from impersonation', { chatId, participantId });
      const newImpersonating = currentImpersonating.filter((id) => id !== participantId);
      const updateData: Partial<ChatMetadata> = { impersonatingParticipantIds: newImpersonating };

      if (result.activeTypingParticipantId === participantId) {
        updateData.activeTypingParticipantId = newImpersonating[0] || null;
      }

      await repos.chats.update(chatId, updateData);
    }

    const updatedChat = await repos.chats.findById(chatId);
    if (updatedChat) {
      return { chat: updatedChat };
    }
  }

  return { chat: result };
}

async function handleAddParticipant(
  chatId: string,
  data: z.infer<typeof addParticipantSchema>,
  currentParticipantCount: number,
  userId: string,
  repos: Repos
): Promise<{ chat: ChatMetadata } | { error: string; status: number }> {
  if (!data.characterId) {
    return { error: 'characterId is required for CHARACTER participants', status: 400 };
  }

  const character = await repos.characters.findById(data.characterId);
  if (!character || character.userId !== userId) {
    return { error: 'Character not found', status: 404 };
  }

  const controlledBy = data.controlledBy || character.controlledBy || 'llm';
  const isUserControlled = controlledBy === 'user';

  if (!isUserControlled && !data.connectionProfileId) {
    return { error: 'connectionProfileId is required for LLM-controlled CHARACTER participants', status: 400 };
  }

  if (data.connectionProfileId) {
    const profile = await repos.connections.findById(data.connectionProfileId);
    if (!profile || profile.userId !== userId) {
      return { error: 'Connection profile not found', status: 404 };
    }
  }

  let result = await repos.chats.addParticipant(chatId, {
    type: 'CHARACTER',
    characterId: data.characterId,
    controlledBy: controlledBy,
    connectionProfileId: data.connectionProfileId || null,
    imageProfileId: data.imageProfileId || null,
    systemPromptOverride: data.systemPromptOverride || null,
    displayOrder: data.displayOrder ?? currentParticipantCount,
    isActive: true,
    hasHistoryAccess: data.hasHistoryAccess ?? false,
    joinScenario: data.joinScenario || null,
  });

  if (!result) {
    return { error: 'Failed to add participant', status: 500 };
  }

  if (character.tags && character.tags.length > 0) {
    const existingTagIds = new Set(result.tags || []);
    const newTags = character.tags.filter((tagId: string) => !existingTagIds.has(tagId));

    if (newTags.length > 0) {
      logger.debug('[Chats v1] Adding character tags to chat', {
        chatId,
        characterId: data.characterId,
        newTagCount: newTags.length,
      });

      const mergedTags = [...(result.tags || []), ...newTags];
      const updatedChat = await repos.chats.update(chatId, { tags: mergedTags });
      if (updatedChat) {
        return { chat: updatedChat };
      }
    }
  }

  return { chat: result };
}

async function handleRemoveParticipant(
  chatId: string,
  participantId: string,
  repos: Repos
): Promise<{ chat: ChatMetadata } | { error: string; status: number }> {
  try {
    const result = await repos.chats.removeParticipant(chatId, participantId);
    if (!result) {
      return { error: 'Participant not found', status: 404 };
    }
    return { chat: result };
  } catch (error) {
    if (error instanceof Error && error.message.includes('last participant')) {
      return { error: 'Cannot remove the last participant from a chat', status: 400 };
    }
    throw error;
  }
}

async function processChatUpdates(
  chatId: string,
  existingChat: ChatMetadata,
  validatedData: z.infer<typeof chatUpdateRequestSchema>,
  userId: string,
  repos: Repos
): Promise<{ chat: ChatMetadata } | { error: string; status: number }> {
  let updatedChat = existingChat;

  if (typeof validatedData.roleplayTemplateId !== 'undefined') {
    if (validatedData.roleplayTemplateId !== null) {
      const template = await repos.roleplayTemplates.findById(validatedData.roleplayTemplateId);
      if (!template) {
        return { error: 'Roleplay template not found', status: 404 };
      }
    }

    const result = await repos.chats.update(chatId, {
      roleplayTemplateId: validatedData.roleplayTemplateId,
    });
    if (result) updatedChat = result;
  }

  if (validatedData.chat) {
    if (validatedData.chat.roleplayTemplateId !== undefined && validatedData.chat.roleplayTemplateId !== null) {
      const template = await repos.roleplayTemplates.findById(validatedData.chat.roleplayTemplateId);
      if (!template) {
        return { error: 'Roleplay template not found', status: 404 };
      }
    }

    if (validatedData.chat.projectId !== undefined) {
      if (validatedData.chat.projectId !== null) {
        const project = await repos.projects.findById(validatedData.chat.projectId);
        if (!project || project.userId !== userId) {
          return { error: 'Project not found', status: 404 };
        }

        if (!project.allowAnyCharacter) {
          const characterIds = updatedChat.participants
            .filter((p) => p.type === 'CHARACTER' && p.characterId)
            .map((p) => p.characterId as string);

          const newCharacterIds = characterIds.filter((id) => !project.characterRoster.includes(id));
          if (newCharacterIds.length > 0) {
            await repos.projects.update(validatedData.chat.projectId, {
              characterRoster: [...project.characterRoster, ...newCharacterIds],
            });
          }
        }
      }
    }

    const result = await repos.chats.update(chatId, validatedData.chat);
    if (result) updatedChat = result;
  }

  if (validatedData.updateParticipant) {
    const result = await handleParticipantUpdate(chatId, validatedData.updateParticipant, userId, repos);
    if ('error' in result) return result;
    updatedChat = result.chat;
  }

  if (validatedData.addParticipant) {
    const result = await handleAddParticipant(
      chatId,
      validatedData.addParticipant,
      updatedChat.participants.length,
      userId,
      repos
    );
    if ('error' in result) return result;
    updatedChat = result.chat;
  }

  if (validatedData.removeParticipantId) {
    const result = await handleRemoveParticipant(chatId, validatedData.removeParticipantId, repos);
    if ('error' in result) return result;
    updatedChat = result.chat;
  }

  return { chat: updatedChat };
}

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createAuthenticatedParamsHandler<{ id: string }>(async (req, { user, repos }, { id }) => {
  const action = getActionParam(req);

  // Handle export action
  if (action === 'export') {
    try {
      const chat = await repos.chats.findById(id);
      if (!chat || chat.userId !== user.id) {
        return notFound('Chat');
      }

      const allEvents = await repos.chats.getMessages(id);
      const messages = allEvents.filter((event) => event.type === 'message');

      const characterParticipant = chat.participants.find((p) => p.type === 'CHARACTER' && p.characterId);
      if (!characterParticipant?.characterId) {
        return notFound('No character in chat');
      }

      const character = await repos.characters.findById(characterParticipant.characterId);
      if (!character) {
        return notFound('Character');
      }

      const userName = user.name || 'User';

      const formattedMessages = messages.map((msg) => ({
        id: msg.id,
        chatId: id,
        role: msg.role,
        content: msg.content,
        createdAt: new Date(msg.createdAt),
        updatedAt: new Date(msg.createdAt),
        swipeGroupId: msg.swipeGroupId || null,
        swipeIndex: msg.swipeIndex || null,
        tokenCount: msg.tokenCount || null,
        rawResponse: msg.rawResponse || null,
      }));

      const chatForExport = {
        ...chat,
        createdAt: new Date(chat.createdAt),
        updatedAt: new Date(chat.updatedAt),
      };

      const jsonlContent = exportSTChatAsJSONL(chatForExport, formattedMessages, character.name, userName);
      const chatCreatedTime = new Date(chat.createdAt).getTime();
      const filename = `${character.name}_chat_${chatCreatedTime}.jsonl`;

      return new NextResponse(jsonlContent, {
        headers: {
          'Content-Type': 'application/x-ndjson',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    } catch (error) {
      logger.error('[Chats v1] Error exporting chat', { chatId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to export chat');
    }
  }

  // Handle get-avatars action
  if (action === 'get-avatars') {
    try {
      logger.debug('[Chats v1] Getting avatar overrides', { chatId: id });

      const chat = await repos.chats.findById(id);
      if (!chat || chat.userId !== user.id) {
        return notFound('Chat');
      }

      // Get all characters that have avatar overrides for this chat
      const allCharacters = await repos.characters.findByUserId(user.id);

      // Collect avatar overrides from all characters for this chat
      const enrichedOverrides = await Promise.all(
        allCharacters.flatMap(character =>
          (character.avatarOverrides || [])
            .filter(override => override.chatId === id)
            .map(async (override) => {
              const fileEntry = await repos.files.findById(override.imageId);
              return {
                chatId: id,
                characterId: character.id,
                imageId: override.imageId,
                character: { id: character.id, name: character.name },
                image: fileEntry ? {
                  id: fileEntry.id,
                  filepath: getFilePath(fileEntry),
                  url: null,
                } : null,
              };
            })
        )
      );

      return NextResponse.json({ data: enrichedOverrides });
    } catch (error) {
      logger.error('[Chats v1] Error fetching avatar overrides', { chatId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch avatar overrides');
    }
  }

  // Handle cost action
  if (action === 'cost') {
    try {
      const chat = await repos.chats.findById(id);
      if (!chat) {
        return notFound('Chat');
      }
      if (chat.userId !== user.id) {
        return forbidden();
      }

      const searchParams = req.nextUrl.searchParams;
      const detailed = searchParams.get('detailed') === 'true';

      const breakdown = detailed
        ? await getDetailedChatCostBreakdown(id, user.id)
        : await getChatCostBreakdown(id, user.id);

      logger.debug('[Chats v1] Cost breakdown retrieved', {
        chatId: id,
        totalTokens: breakdown.totalTokens,
        estimatedCostUSD: breakdown.estimatedCostUSD,
      });

      return NextResponse.json(breakdown);
    } catch (error) {
      logger.error('[Chats v1] Failed to get cost breakdown', { chatId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to get cost breakdown');
    }
  }

  // Default: get chat
  try {
    logger.debug('[Chats v1] GET chat', { chatId: id, userId: user.id });

    const chatMetadata = await repos.chats.findById(id);
    if (!chatMetadata || chatMetadata.userId !== user.id) {
      return notFound('Chat');
    }

    const enrichedParticipants = await Promise.all(
      chatMetadata.participants.map((p) => enrichParticipantDetail(p, repos))
    );

    const chatEvents = await repos.chats.getMessages(id);
    const messages = await Promise.all(
      chatEvents
        .filter((event) => event.type === 'message')
        .map(async (event) => {
          if (event.type !== 'message') return null;

          const linkedFiles = await repos.files.findByLinkedTo(event.id);
          const attachments = linkedFiles.map((file) => ({
            id: file.id,
            filename: file.originalFilename,
            filepath: getFilePath(file),
            mimeType: file.mimeType,
          }));

          return {
            id: event.id,
            role: event.role,
            content: event.content,
            tokenCount: event.tokenCount || null,
            promptTokens: event.promptTokens || null,
            completionTokens: event.completionTokens || null,
            createdAt: event.createdAt,
            swipeGroupId: event.swipeGroupId || null,
            swipeIndex: event.swipeIndex || null,
            participantId: event.participantId || null,
            attachments,
            debugMemoryLogs: event.debugMemoryLogs || undefined,
          };
        })
    ).then((results) => results.filter(Boolean));

    let projectName: string | null = null;
    if (chatMetadata.projectId) {
      try {
        const project = await repos.projects.findById(chatMetadata.projectId);
        if (project) {
          projectName = project.name;
        }
      } catch {
        // Project might have been deleted
      }
    }

    const chat = {
      id: chatMetadata.id,
      title: chatMetadata.title,
      contextSummary: chatMetadata.contextSummary,
      roleplayTemplateId: chatMetadata.roleplayTemplateId,
      lastTurnParticipantId: chatMetadata.lastTurnParticipantId ?? null,
      isPaused: chatMetadata.isPaused ?? false,
      isManuallyRenamed: chatMetadata.isManuallyRenamed ?? false,
      updatedAt: chatMetadata.updatedAt,
      createdAt: chatMetadata.createdAt,
      participants: enrichedParticipants,
      user: { id: user.id, name: user.name, image: user.image },
      messages,
      projectId: chatMetadata.projectId || null,
      projectName,
    };

    return NextResponse.json({ chat });
  } catch (error) {
    logger.error('[Chats v1] Error fetching chat', { chatId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch chat');
  }
});

// ============================================================================
// PUT Handler
// ============================================================================

export const PUT = createAuthenticatedParamsHandler<{ id: string }>(async (req, { user, repos }, { id }) => {
  try {
    logger.debug('[Chats v1] PUT chat', { chatId: id, userId: user.id });

    const existingChat = await repos.chats.findById(id);
    if (!existingChat || existingChat.userId !== user.id) {
      return notFound('Chat');
    }

    const body = await req.json();
    const validatedData = chatUpdateRequestSchema.parse(body);

    const result = await processChatUpdates(id, existingChat, validatedData, user.id, repos);

    if ('error' in result) {
      if (result.status === 404) {
        return notFound('Resource');
      } else if (result.status === 400) {
        return badRequest(result.error);
      }
      return serverError(result.error);
    }

    const enrichedParticipants = await Promise.all(
      result.chat.participants.map((p) => enrichParticipantDetail(p, repos))
    );

    logger.info('[Chats v1] Chat updated', { chatId: id });

    return NextResponse.json({
      chat: { ...result.chat, participants: enrichedParticipants },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Chats v1] Error updating chat', { chatId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to update chat');
  }
});

// ============================================================================
// DELETE Handler
// ============================================================================

export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(async (req, { user, repos }, { id }) => {
  try {
    logger.debug('[Chats v1] DELETE chat', { chatId: id, userId: user.id });

    const existingChat = await repos.chats.findById(id);
    if (!existingChat || existingChat.userId !== user.id) {
      return notFound('Chat');
    }

    await repos.chats.delete(id);

    logger.info('[Chats v1] Chat deleted', { chatId: id });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('[Chats v1] Error deleting chat', { chatId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to delete chat');
  }
});

// ============================================================================
// POST Handler - Actions
// ============================================================================

export const POST = createAuthenticatedParamsHandler<{ id: string }>(async (req, { user, repos }, { id }) => {
  const action = getActionParam(req);

  // Verify ownership first
  const chat = await repos.chats.findById(id);
  if (!chat || chat.userId !== user.id) {
    return notFound('Chat');
  }

  switch (action) {
    case 'regenerate-title': {
      try {
        logger.debug('[Chats v1] Regenerating title', { chatId: id });

        const chatSettings = await repos.chatSettings.findByUserId(user.id);
        if (!chatSettings?.cheapLLMSettings) {
          return badRequest('Cheap LLM settings not configured');
        }

        const availableProfiles = await repos.connections.findByUserId(user.id);
        if (availableProfiles.length === 0) {
          return badRequest('No connection profiles available');
        }

        const characterParticipant = chat.participants.find((p) => p.type === 'CHARACTER');
        let connectionProfile = availableProfiles[0];

        if (characterParticipant?.connectionProfileId) {
          const participantProfile = availableProfiles.find((p) => p.id === characterParticipant.connectionProfileId);
          if (participantProfile) {
            connectionProfile = participantProfile;
          }
        }

        const cheapLLM = getCheapLLMProvider(
          connectionProfile,
          {
            strategy: chatSettings.cheapLLMSettings.strategy,
            userDefinedProfileId: chatSettings.cheapLLMSettings.userDefinedProfileId ?? undefined,
            defaultCheapProfileId: chatSettings.cheapLLMSettings.defaultCheapProfileId ?? undefined,
            fallbackToLocal: chatSettings.cheapLLMSettings.fallbackToLocal,
          },
          availableProfiles
        );

        if (!cheapLLM) {
          return badRequest('No cheap LLM available for title generation');
        }

        const allMessages = await repos.chats.getMessages(id);
        const conversationMessages: ChatMessage[] = allMessages
          .filter((msg) => msg.type === 'message')
          .filter((msg) => {
            const role = (msg as { role: string }).role;
            return role === 'USER' || role === 'ASSISTANT';
          })
          .map((msg) => ({
            role: (msg as { role: string }).role.toLowerCase() as 'user' | 'assistant',
            content: (msg as { content: string }).content,
          }));

        if (conversationMessages.length === 0) {
          return badRequest('No messages in chat to generate title from');
        }

        const result = await titleChat(conversationMessages, undefined, cheapLLM, user.id);

        if (!result.success || !result.result) {
          logger.error('[Chats v1] Title generation failed', { chatId: id, error: result.error });
          return serverError(result.error || 'Failed to generate title');
        }

        const newTitle = result.result;

        await repos.chats.update(id, {
          title: newTitle,
          isManuallyRenamed: false,
          updatedAt: new Date().toISOString(),
        });

        logger.info('[Chats v1] Title regenerated', { chatId: id, newTitle });

        return NextResponse.json({ success: true, title: newTitle });
      } catch (error) {
        logger.error('[Chats v1] Error regenerating title', { chatId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to regenerate title');
      }
    }

    case 'add-tag': {
      try {
        const body = await req.json();
        const validatedData = addTagSchema.parse(body);

        const tag = await repos.tags.findById(validatedData.tagId);
        if (!tag) {
          return notFound('Tag');
        }

        if (tag.userId !== user.id) {
          return forbidden();
        }

        await repos.chats.addTag(id, validatedData.tagId);

        logger.info('[Chats v1] Tag added', { chatId: id, tagId: validatedData.tagId });

        return NextResponse.json({ success: true, tag }, { status: 201 });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return validationError(error);
        }
        logger.error('[Chats v1] Error adding tag', { chatId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to add tag to chat');
      }
    }

    case 'remove-tag': {
      try {
        const body = await req.json();
        const validatedData = removeTagSchema.parse(body);

        await repos.chats.removeTag(id, validatedData.tagId);

        logger.info('[Chats v1] Tag removed', { chatId: id, tagId: validatedData.tagId });

        return NextResponse.json({ success: true });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return validationError(error);
        }
        logger.error('[Chats v1] Error removing tag', { chatId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to remove tag from chat');
      }
    }

    case 'impersonate': {
      try {
        const body = await req.json();
        const { participantId } = impersonateSchema.parse(body);

        logger.debug('[Chats v1] Starting impersonation', { chatId: id, participantId });

        const participant = chat.participants.find((p) => p.id === participantId);
        if (!participant) {
          return notFound('Participant');
        }
        if (!participant.isActive) {
          return badRequest('Participant is not active');
        }

        const updatedChat = await repos.chats.addImpersonation(id, participantId);
        if (!updatedChat) {
          return serverError('Failed to start impersonation');
        }

        let characterName = 'Unknown';
        if (participant.characterId) {
          const character = await repos.characters.findById(participant.characterId);
          if (character) {
            characterName = character.name;
          }
        }

        logger.info('[Chats v1] Impersonation started', { chatId: id, participantId, characterName });

        return NextResponse.json({
          success: true,
          participantId,
          characterName,
          impersonatingParticipantIds: updatedChat.impersonatingParticipantIds,
          activeTypingParticipantId: updatedChat.activeTypingParticipantId,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return validationError(error);
        }
        logger.error('[Chats v1] Error starting impersonation', { chatId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to start impersonation');
      }
    }

    case 'stop-impersonate': {
      try {
        const body = await req.json();
        const { participantId, newConnectionProfileId } = stopImpersonateSchema.parse(body);

        logger.debug('[Chats v1] Stopping impersonation', { chatId: id, participantId });

        const participant = chat.participants.find((p) => p.id === participantId);
        if (!participant) {
          return notFound('Participant');
        }

        let updatedChat = await repos.chats.removeImpersonation(id, participantId);
        if (!updatedChat) {
          return serverError('Failed to stop impersonation');
        }

        if (newConnectionProfileId) {
          const profile = await repos.connections.findById(newConnectionProfileId);
          if (!profile || profile.userId !== user.id) {
            return notFound('Connection profile');
          }

          updatedChat = await repos.chats.updateParticipant(id, participantId, {
            connectionProfileId: newConnectionProfileId,
            controlledBy: 'llm',
          });
        }

        let characterName = 'Unknown';
        if (participant.characterId) {
          const character = await repos.characters.findById(participant.characterId);
          if (character) {
            characterName = character.name;
          }
        }

        logger.info('[Chats v1] Impersonation stopped', { chatId: id, participantId, characterName });

        return NextResponse.json({
          success: true,
          participantId,
          characterName,
          impersonatingParticipantIds: updatedChat?.impersonatingParticipantIds || [],
          activeTypingParticipantId: updatedChat?.activeTypingParticipantId || null,
          newConnectionProfileId: newConnectionProfileId || null,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return validationError(error);
        }
        logger.error('[Chats v1] Error stopping impersonation', { chatId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to stop impersonation');
      }
    }

    case 'set-active-speaker': {
      try {
        const body = await req.json();
        const { participantId } = setActiveSpeakerSchema.parse(body);

        logger.debug('[Chats v1] Setting active speaker', { chatId: id, participantId });

        const participant = chat.participants.find((p) => p.id === participantId);
        if (!participant) {
          return notFound('Participant');
        }

        let impersonatingIds = chat.impersonatingParticipantIds || [];
        if (!impersonatingIds.includes(participantId)) {
          if (participant.controlledBy === 'user') {
            logger.info('[Chats v1] Auto-adding user-controlled participant to impersonation', {
              chatId: id,
              participantId,
            });
            impersonatingIds = [...impersonatingIds, participantId];
            await repos.chats.update(id, { impersonatingParticipantIds: impersonatingIds });
          } else {
            return badRequest('Participant is not being impersonated');
          }
        }

        const updatedChat = await repos.chats.setActiveTypingParticipant(id, participantId);
        if (!updatedChat) {
          return serverError('Failed to set active speaker');
        }

        let characterName = 'Unknown';
        if (participant.characterId) {
          const character = await repos.characters.findById(participant.characterId);
          if (character) {
            characterName = character.name;
          }
        }

        logger.info('[Chats v1] Active speaker set', { chatId: id, participantId, characterName });

        return NextResponse.json({
          success: true,
          activeTypingParticipantId: participantId,
          characterName,
          impersonatingParticipantIds: impersonatingIds,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return validationError(error);
        }
        logger.error('[Chats v1] Error setting active speaker', { chatId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to set active speaker');
      }
    }

    case 'turn': {
      try {
        const body = await req.json();
        const { action: turnAction, participantId } = turnActionSchema.parse(body);

        logger.debug('[Chats v1] Processing turn action', { chatId: id, action: turnAction, participantId });

        const participant = chat.participants.find((p) => p.id === participantId);
        if (!participant) {
          return notFound('Participant');
        }
        if (!participant.isActive) {
          return badRequest('Participant is not active');
        }

        const userParticipant = findUserParticipant(chat.participants);
        const userParticipantId = userParticipant?.id ?? null;

        const messages = await repos.chats.getMessages(id);
        const messageEvents = messages.filter(
          (m): m is typeof m & { type: 'message' } => m.type === 'message'
        ) as unknown as MessageEvent[];

        let turnState = calculateTurnStateFromHistory({
          messages: messageEvents,
          participants: chat.participants,
          userParticipantId,
        });

        switch (turnAction) {
          case 'nudge':
            turnState = nudgeParticipant(turnState, participantId);
            break;
          case 'queue':
            turnState = addToQueue(turnState, participantId);
            break;
          case 'dequeue':
            turnState = removeFromQueue(turnState, participantId);
            break;
        }

        const activeCharacterParticipants = getActiveCharacterParticipants(chat.participants);
        const charactersMap = new Map<string, Character>();
        for (const p of activeCharacterParticipants) {
          if (p.characterId) {
            const char = await repos.characters.findById(p.characterId);
            if (char) {
              charactersMap.set(p.characterId, char);
            }
          }
        }

        const nextSpeakerResult = selectNextSpeaker(chat.participants, charactersMap, turnState, userParticipantId);

        const affectedCharacter = participant.characterId ? charactersMap.get(participant.characterId) : null;

        logger.debug('[Chats v1] Turn action completed', {
          chatId: id,
          action: turnAction,
          participantId,
          nextSpeakerId: nextSpeakerResult.nextSpeakerId,
        });

        return NextResponse.json({
          success: true,
          action: turnAction,
          participant: {
            id: participantId,
            name: affectedCharacter?.name ?? 'Unknown',
            queuePosition: getQueuePosition(turnState, participantId),
          },
          turn: {
            nextSpeakerId: nextSpeakerResult.nextSpeakerId,
            reason: nextSpeakerResult.reason,
            explanation: getSelectionExplanation(nextSpeakerResult),
            cycleComplete: nextSpeakerResult.cycleComplete,
            isUsersTurn: nextSpeakerResult.nextSpeakerId === null,
          },
          state: {
            queue: turnState.queue,
          },
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return validationError(error);
        }
        logger.error('[Chats v1] Error processing turn action', { chatId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to process turn action');
      }
    }

    case 'add-participant': {
      try {
        const body = await req.json();
        const validatedData = addParticipantSchema.parse(body);

        logger.debug('[Chats v1] Adding participant', { chatId: id, type: validatedData.type });

        // Check if character is already in the chat
        if (validatedData.type === 'CHARACTER' && validatedData.characterId) {
          const existingParticipant = chat.participants.find(
            (p) => p.type === 'CHARACTER' && p.characterId === validatedData.characterId && p.isActive
          );
          if (existingParticipant) {
            return badRequest('Character is already in this chat');
          }
        }

        const result = await handleAddParticipant(id, validatedData, chat.participants.length, user.id, repos);

        if ('error' in result) {
          if (result.status === 404) return notFound('Resource');
          if (result.status === 400) return badRequest(result.error);
          return serverError(result.error);
        }

        const newParticipant = result.chat.participants.find(
          (p) => p.characterId === validatedData.characterId
        );

        const enrichedParticipant = newParticipant ? await enrichParticipant(newParticipant, repos) : null;

        logger.info('[Chats v1] Participant added', { chatId: id, participantId: newParticipant?.id });

        return NextResponse.json({ participant: enrichedParticipant, chat: result.chat }, { status: 201 });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return validationError(error);
        }
        logger.error('[Chats v1] Error adding participant', { chatId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to add participant');
      }
    }

    case 'update-participant': {
      try {
        const body = await req.json();
        const validatedData = updateParticipantSchema.parse(body);

        logger.debug('[Chats v1] Updating participant', { chatId: id, participantId: validatedData.participantId });

        const result = await handleParticipantUpdate(id, validatedData, user.id, repos);

        if ('error' in result) {
          if (result.status === 404) return notFound('Resource');
          if (result.status === 400) return badRequest(result.error);
          return serverError(result.error);
        }

        const updatedParticipant = result.chat.participants.find((p) => p.id === validatedData.participantId);
        const enrichedParticipant = updatedParticipant ? await enrichParticipant(updatedParticipant, repos) : null;

        logger.info('[Chats v1] Participant updated', { chatId: id, participantId: validatedData.participantId });

        return NextResponse.json({ participant: enrichedParticipant, chat: result.chat });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return validationError(error);
        }
        logger.error('[Chats v1] Error updating participant', { chatId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to update participant');
      }
    }

    case 'remove-participant': {
      try {
        const body = await req.json();
        const validatedData = removeParticipantSchema.parse(body);

        logger.debug('[Chats v1] Removing participant', { chatId: id, participantId: validatedData.participantId });

        const participantToRemove = chat.participants.find((p) => p.id === validatedData.participantId);
        if (!participantToRemove) {
          return notFound('Participant');
        }

        const activeCharacters = chat.participants.filter((p) => p.type === 'CHARACTER' && p.isActive);
        if (activeCharacters.length <= 1 && participantToRemove.type === 'CHARACTER') {
          return badRequest('Cannot remove the last character from the chat');
        }

        const result = await handleRemoveParticipant(id, validatedData.participantId, repos);

        if ('error' in result) {
          if (result.status === 404) return notFound('Resource');
          if (result.status === 400) return badRequest(result.error);
          return serverError(result.error);
        }

        logger.info('[Chats v1] Participant removed', { chatId: id, participantId: validatedData.participantId });

        return NextResponse.json({ success: true, chat: result.chat });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return validationError(error);
        }

        if (error instanceof Error && error.message.includes('last participant')) {
          return badRequest('Cannot remove the last participant from a chat');
        }

        logger.error('[Chats v1] Error removing participant', { chatId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to remove participant');
      }
    }

    case 'bulk-reattribute': {
      try {
        const body = await req.json();
        const validatedData = bulkReattributeSchema.parse(body);
        const { sourceParticipantId, targetParticipantId, roleFilter } = validatedData;

        if (sourceParticipantId === targetParticipantId) {
          return badRequest('Source and target participants must be different');
        }

        logger.debug('[Chats v1] Processing bulk message re-attribution', {
          chatId: id,
          sourceParticipantId,
          targetParticipantId,
          roleFilter,
        });

        // Validate participants exist in this chat
        if (sourceParticipantId !== null) {
          const sourceParticipant = chat.participants.find((p) => p.id === sourceParticipantId);
          if (!sourceParticipant) {
            return badRequest('Source participant not found in chat');
          }
        }

        const targetParticipant = chat.participants.find((p) => p.id === targetParticipantId);
        if (!targetParticipant) {
          return badRequest('Target participant not found in chat');
        }

        // Get all messages
        const allMessages = await repos.chats.getMessages(id);

        // Find all messages matching the criteria
        const affectedMessages = allMessages.filter((msg): msg is MessageEvent => {
          if (msg.type !== 'message') return false;
          // Handle null sourceParticipantId (unassigned messages)
          if (sourceParticipantId === null) {
            if (msg.participantId !== null && msg.participantId !== undefined) return false;
          } else {
            if (msg.participantId !== sourceParticipantId) return false;
          }
          if (roleFilter === 'both') return true;
          return msg.role === roleFilter;
        });

        logger.debug('[Chats v1] Found messages to re-attribute', {
          chatId: id,
          affectedCount: affectedMessages.length,
          roleFilter,
        });

        if (affectedMessages.length === 0) {
          return NextResponse.json({
            success: true,
            messagesUpdated: 0,
            memoriesDeleted: 0,
          });
        }

        // Delete memories for all affected messages
        let memoriesDeleted = 0;
        const affectedMessageIds = new Set(affectedMessages.map((m) => m.id));

        for (const msg of affectedMessages) {
          const memoriesFromMessage = await repos.memories.findBySourceMessageId(msg.id);

          logger.debug('[Chats v1] Found memories for message', {
            messageId: msg.id,
            memoryCount: memoriesFromMessage.length,
          });

          for (const memory of memoriesFromMessage) {
            try {
              const deleted = await deleteMemoryWithVector(memory.characterId, memory.id);
              if (deleted) {
                memoriesDeleted++;
                logger.debug('[Chats v1] Deleted memory during bulk re-attribution', {
                  memoryId: memory.id,
                  characterId: memory.characterId,
                  sourceMessageId: msg.id,
                });
              }
            } catch (error) {
              logger.error(
                '[Chats v1] Failed to delete memory during bulk re-attribution',
                {
                  memoryId: memory.id,
                  error: error instanceof Error ? error.message : String(error),
                }
              );
              // Continue with other memories - best effort cleanup
            }
          }
        }

        // Update all messages
        const updatedMessages: ChatEvent[] = allMessages.map((msg) => {
          if (msg.type === 'message' && affectedMessageIds.has(msg.id)) {
            return { ...msg, participantId: targetParticipantId };
          }
          return msg;
        });

        // Rewrite all messages
        await repos.chats.clearMessages(id);
        for (const msg of updatedMessages) {
          await repos.chats.addMessage(id, msg);
        }

        // Update chat's updatedAt timestamp
        await repos.chats.update(id, {});

        logger.info('[Chats v1] Bulk character replace completed', {
          chatId: id,
          sourceParticipantId,
          targetParticipantId,
          roleFilter,
          messagesUpdated: affectedMessages.length,
          memoriesDeleted,
        });

        return NextResponse.json({
          success: true,
          messagesUpdated: affectedMessages.length,
          memoriesDeleted,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return validationError(error);
        }
        logger.error('[Chats v1] Error in bulk re-attribution', { chatId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to re-attribute messages');
      }
    }

    case 'set-avatar': {
      try {
        const body = await req.json();
        const { characterId, imageId } = avatarOverrideSchema.parse(body);

        logger.debug('[Chats v1] Setting avatar override', { chatId: id, characterId, imageId });

        // Verify character exists and belongs to user
        const character = await repos.characters.findById(characterId);
        if (!character || character.userId !== user.id) {
          return notFound('Character');
        }

        // Verify image exists in repository and belongs to user
        const fileEntry = await repos.files.findById(imageId);
        if (!fileEntry || fileEntry.userId !== user.id) {
          return notFound('Image');
        }

        // Update character's avatarOverrides array
        const existingOverrides = character.avatarOverrides || [];
        const overrideIndex = existingOverrides.findIndex(o => o.chatId === id);

        let updatedOverrides;
        if (overrideIndex >= 0) {
          // Update existing override
          updatedOverrides = [...existingOverrides];
          updatedOverrides[overrideIndex] = { chatId: id, imageId };
        } else {
          // Add new override
          updatedOverrides = [...existingOverrides, { chatId: id, imageId }];
        }

        await repos.characters.update(characterId, { avatarOverrides: updatedOverrides });

        const override = {
          chatId: id,
          characterId,
          imageId,
          character: { id: character.id, name: character.name },
          image: {
            id: fileEntry.id,
            filepath: getFilePath(fileEntry),
            url: null,
          },
        };

        logger.info('[Chats v1] Avatar override set', { chatId: id, characterId, imageId });

        return NextResponse.json({ data: override });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return validationError(error);
        }
        logger.error('[Chats v1] Error setting avatar override', { chatId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to set avatar override');
      }
    }

    case 'remove-avatar': {
      try {
        const body = await req.json();
        const { characterId } = removeAvatarSchema.parse(body);

        logger.debug('[Chats v1] Removing avatar override', { chatId: id, characterId });

        // Verify character exists and belongs to user
        const character = await repos.characters.findById(characterId);
        if (!character || character.userId !== user.id) {
          return notFound('Character');
        }

        // Remove avatar override from character's avatarOverrides array
        const existingOverrides = character.avatarOverrides || [];
        const updatedOverrides = existingOverrides.filter(o => o.chatId !== id);

        await repos.characters.update(characterId, { avatarOverrides: updatedOverrides });

        logger.info('[Chats v1] Avatar override removed', { chatId: id, characterId });

        return NextResponse.json({ data: { success: true } });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return validationError(error);
        }
        logger.error('[Chats v1] Error removing avatar override', { chatId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to remove avatar override');
      }
    }

    case 'add-tool-result': {
      try {
        const body = await req.json();
        const validated = toolResultSchema.parse(body);

        logger.debug('[Chats v1] Adding tool result', { chatId: id, tool: validated.tool });

        // Create a TOOL message event
        const toolResultMessage = await repos.chats.addMessage(id, {
          type: 'message',
          id: randomUUID(),
          role: 'TOOL',
          content: JSON.stringify({
            tool: validated.tool,
            initiatedBy: validated.initiatedBy,
            prompt: validated.prompt,
            result: validated.result,
            images: validated.images,
            success: validated.initiatedBy === 'user' ? true : validated.result?.success ?? false,
          }),
          createdAt: new Date().toISOString(),
          attachments: [],
        });

        logger.info('[Chats v1] Tool result added', { chatId: id, tool: validated.tool });

        return NextResponse.json({
          success: true,
          message: toolResultMessage,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return validationError(error);
        }
        logger.error('[Chats v1] Error adding tool result', { chatId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to add tool result');
      }
    }

    case 'queue-memories': {
      try {
        const body = await req.json();
        const { characterId, characterName, messagePairs } = queueMemoriesSchema.parse(body);

        logger.debug('[Chats v1] Queueing memory extraction', { chatId: id, characterId });

        // Get cheap LLM settings to determine which connection profile to use
        const chatSettings = await repos.chatSettings.findByUserId(user.id);
        const cheapLLMSettings = chatSettings?.cheapLLMSettings;

        logger.debug('[Chats v1] Cheap LLM settings', {
          strategy: cheapLLMSettings?.strategy,
          defaultCheapProfileId: cheapLLMSettings?.defaultCheapProfileId,
          userDefinedProfileId: cheapLLMSettings?.userDefinedProfileId,
        });

        // Determine connection profile based on strategy
        let connectionProfileId: string | null | undefined = null;
        let profile = null;

        // Try global default first (if set and valid)
        if (cheapLLMSettings?.defaultCheapProfileId) {
          profile = await repos.connections.findById(cheapLLMSettings.defaultCheapProfileId);
          if (profile && profile.userId === user.id) {
            connectionProfileId = cheapLLMSettings.defaultCheapProfileId;
            logger.debug('[Chats v1] Using global default cheap LLM', { profileId: connectionProfileId });
          }
        }

        // If no valid global default, use strategy-based selection
        if (!connectionProfileId && cheapLLMSettings?.strategy === 'USER_DEFINED' && cheapLLMSettings?.userDefinedProfileId) {
          profile = await repos.connections.findById(cheapLLMSettings.userDefinedProfileId);
          if (profile && profile.userId === user.id) {
            connectionProfileId = cheapLLMSettings.userDefinedProfileId;
            logger.debug('[Chats v1] Using user-defined cheap LLM', { profileId: connectionProfileId });
          }
        }

        if (!connectionProfileId || !profile) {
          logger.warn('[Chats v1] No valid cheap LLM configured', {
            userId: user.id,
            strategy: cheapLLMSettings?.strategy,
          });
          return badRequest('No valid cheap LLM configured. Please set a cheap LLM profile in settings.');
        }

        logger.debug('[Chats v1] Using cheap LLM profile', {
          profileId: connectionProfileId,
          profileName: profile.name,
          provider: profile.provider,
        });

        // Build a map of participantId -> character info for multi-character support
        const participantCharacterMap = new Map<string, { characterId: string; characterName: string }>();
        for (const participant of chat.participants) {
          if (participant.type === 'CHARACTER' && participant.characterId) {
            const char = await repos.characters.findById(participant.characterId);
            if (char && char.userId === user.id) {
              participantCharacterMap.set(participant.id, {
                characterId: char.id,
                characterName: char.name,
              });
            }
          }
        }

        // Fallback character (the one passed in request, if valid)
        let fallbackCharacter: { characterId: string; characterName: string } | null = null;
        if (characterId) {
          const character = await repos.characters.findById(characterId);
          if (character && character.userId === user.id) {
            fallbackCharacter = {
              characterId: character.id,
              characterName: characterName || character.name,
            };
          }
        }

        // Use provided message pairs or build them from chat messages
        let pairsWithCharacter: MessagePairWithCharacter[];

        if (messagePairs && Array.isArray(messagePairs) && messagePairs.length > 0) {
          // Use provided pairs with fallback character
          if (!fallbackCharacter) {
            return notFound('Character');
          }
          pairsWithCharacter = messagePairs.map((pair) => ({
            ...pair,
            characterId: fallbackCharacter!.characterId,
            characterName: fallbackCharacter!.characterName,
          }));
        } else {
          // Build message pairs from chat messages, respecting each message's participantId
          const messages = await repos.chats.getMessages(id);
          const messageList = messages.filter(
            (m): m is MessageEvent =>
              m.type === 'message' && (m.role === 'USER' || m.role === 'ASSISTANT')
          );

          // Helper to get character name for a participant
          const getParticipantName = (participantId: string | null | undefined): string => {
            if (!participantId) return 'Character';
            const charInfo = participantCharacterMap.get(participantId);
            return charInfo?.characterName || 'Character';
          };

          // Helper to get user name for user messages
          const personaName = 'User';

          pairsWithCharacter = [];

          // Track the index of the last user message
          let lastUserMessageIndex = -1;

          for (let i = 0; i < messageList.length; i++) {
            const msg = messageList[i];

            if (msg.role === 'USER') {
              lastUserMessageIndex = i;
            } else if (msg.role === 'ASSISTANT' && lastUserMessageIndex >= 0) {
              // This is an assistant message - create a memory extraction entry
              const userMessage = messageList[lastUserMessageIndex];

              // Determine which character this assistant message belongs to
              let targetCharacter = fallbackCharacter;
              if (msg.participantId) {
                const participantChar = participantCharacterMap.get(msg.participantId);
                if (participantChar) {
                  targetCharacter = participantChar;
                }
              }

              // Skip if we couldn't determine the character
              if (!targetCharacter) {
                logger.warn('[Chats v1] Skipping message - no character found', {
                  chatId: id,
                  assistantMessageId: msg.id,
                  participantId: msg.participantId,
                });
                continue;
              }

              // Build context: include all messages from last user message to this assistant message
              let contextContent: string;

              if (i === lastUserMessageIndex + 1) {
                // Simple case: assistant message directly follows user message
                contextContent = userMessage.content;
              } else {
                // Multi-character case: include intervening messages for context
                const contextParts: string[] = [];
                contextParts.push(`${personaName}: ${userMessage.content}`);

                // Add all messages between user message and this assistant message
                for (let j = lastUserMessageIndex + 1; j < i; j++) {
                  const intermediateMsg = messageList[j];
                  if (intermediateMsg.role === 'ASSISTANT') {
                    const speakerName = getParticipantName(intermediateMsg.participantId);
                    contextParts.push(`${speakerName}: ${intermediateMsg.content}`);
                  }
                }

                contextContent = contextParts.join('\n\n');
              }

              pairsWithCharacter.push({
                userMessageId: userMessage.id,
                assistantMessageId: msg.id,
                userContent: contextContent,
                assistantContent: msg.content,
                characterId: targetCharacter.characterId,
                characterName: targetCharacter.characterName,
              });
            }
          }
        }

        if (pairsWithCharacter.length === 0) {
          return badRequest('No message pairs found to analyze');
        }

        // Group pairs by character for efficient batch processing
        const pairsByCharacter = new Map<string, { characterName: string; pairs: MessagePair[] }>();
        for (const pair of pairsWithCharacter) {
          const existing = pairsByCharacter.get(pair.characterId);
          if (existing) {
            existing.pairs.push({
              userMessageId: pair.userMessageId,
              assistantMessageId: pair.assistantMessageId,
              userContent: pair.userContent,
              assistantContent: pair.assistantContent,
            });
          } else {
            pairsByCharacter.set(pair.characterId, {
              characterName: pair.characterName,
              pairs: [{
                userMessageId: pair.userMessageId,
                assistantMessageId: pair.assistantMessageId,
                userContent: pair.userContent,
                assistantContent: pair.assistantContent,
              }],
            });
          }
        }

        logger.info('[Chats v1] Queueing memory extraction jobs', {
          chatId: id,
          characterCount: pairsByCharacter.size,
          totalPairs: pairsWithCharacter.length,
        });

        // Queue jobs for each character
        const allJobIds: string[] = [];
        for (const [charId, { characterName: charName, pairs }] of pairsByCharacter) {
          const jobIds = await enqueueMemoryExtractionBatch(
            user.id,
            id,
            charId,
            charName,
            connectionProfileId,
            pairs,
            { priority: 0 } // Low priority for bulk operations
          );
          allJobIds.push(...jobIds);
        }

        // Start the processor if not already running
        ensureProcessorRunning();

        return NextResponse.json({
          success: true,
          jobCount: allJobIds.length,
          chatId: id,
          characterCount: pairsByCharacter.size,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return validationError(error);
        }
        const errorMessage = getErrorMessage(error);
        logger.error('[Chats v1] Error queueing memories', { chatId: id, error: errorMessage });
        return serverError(errorMessage);
      }
    }

    default:
      return badRequest(
        `Unknown action: ${action}. Available actions: regenerate-title, add-tag, remove-tag, impersonate, stop-impersonate, set-active-speaker, turn, add-participant, update-participant, remove-participant, bulk-reattribute, get-avatars, set-avatar, remove-avatar, add-tool-result, queue-memories`
      );
  }
});

// ============================================================================
// PATCH Handler - Persist Turn State
// ============================================================================

export const PATCH = createAuthenticatedParamsHandler<{ id: string }>(async (req, { user, repos }, { id }) => {
  const action = getActionParam(req);

  // Only support turn action for PATCH
  if (action !== 'turn') {
    return badRequest('PATCH only supports action=turn for persisting turn state');
  }

  try {
    // Verify ownership
    const chat = await repos.chats.findById(id);
    if (!chat || chat.userId !== user.id) {
      return notFound('Chat');
    }

    // Parse and validate request body
    const body = await req.json();
    const { lastTurnParticipantId } = persistTurnSchema.parse(body);

    logger.debug('[Chats v1] Persisting turn state', {
      chatId: id,
      lastTurnParticipantId,
    });

    // If a participant ID is provided, verify it exists and is active
    if (lastTurnParticipantId !== null) {
      const participant = chat.participants.find(p => p.id === lastTurnParticipantId);
      if (!participant) {
        return notFound('Participant');
      }
      if (!participant.isActive) {
        // If the participant is no longer active, log but continue
        logger.debug('[Chats v1] Participant inactive during turn persist', {
          participantId: lastTurnParticipantId,
        });
      }
    }

    // Update the chat metadata with the turn state
    await repos.chats.update(id, {
      lastTurnParticipantId,
    });

    logger.debug('[Chats v1] Turn state persisted', {
      chatId: id,
      lastTurnParticipantId,
    });

    return NextResponse.json({
      success: true,
      lastTurnParticipantId,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Chats v1] Error persisting turn state', { chatId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to persist turn state');
  }
});
