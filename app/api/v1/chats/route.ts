/**
 * Chats API v1 - Collection Endpoint
 *
 * GET /api/v1/chats - List all chats for current user
 * GET /api/v1/chats?action=has-dangerous - Check if any dangerous chats exist
 * POST /api/v1/chats - Create a new chat
 * POST /api/v1/chats?action=import - Import a SillyTavern chat
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler, type AuthenticatedContext } from '@/lib/api/middleware';
import { getActionParam, isValidAction } from '@/lib/api/middleware/actions';
import { buildChatContext, type ChatContext } from '@/lib/chat/initialize';
import { generateGreetingMessage } from '@/lib/chat/initial-greeting';
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service';
import { resolveProviderForDangerousContent } from '@/lib/services/dangerous-content/provider-routing.service';
import { buildFirstMessageContext } from '@/lib/chat/first-message-context';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/errors';
import { z } from 'zod';
import type { ChatEvent, ChatParticipantBaseInput, TimestampConfig } from '@/lib/schemas/types';
import { TimestampConfigSchema } from '@/lib/schemas/types';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import { notFound, badRequest, serverError, validationError } from '@/lib/api/responses';
import {
  enrichParticipantSummary,
  enrichChatsForList,
  filterChatsByExcludedTags,
  cleanEnrichedChats,
} from '@/lib/services/chat-enrichment.service';
import {
  importMultiCharacterChat,
  importLegacyChat,
  type MultiCharacterImportOptions,
  type LegacyImportOptions,
} from '@/lib/import/sillytavern-import-service';

type Repos = RepositoryContainer;
const CHAT_GET_ACTIONS = ['has-dangerous'] as const;
type ChatGetAction = typeof CHAT_GET_ACTIONS[number];
const CHAT_POST_ACTIONS = ['import'] as const;
type ChatPostAction = typeof CHAT_POST_ACTIONS[number];

// ============================================================================
// Schemas
// ============================================================================

// Participant schema for chat creation
const createParticipantSchema = z.object({
  type: z.literal('CHARACTER'),
  characterId: z.uuid(),
  connectionProfileId: z.uuid().optional(),
  imageProfileId: z.uuid().optional(), // Legacy: kept for backwards compatibility but ignored
  controlledBy: z.enum(['llm', 'user']).optional(),
  selectedSystemPromptId: z.uuid().optional(),
});

const createChatSchema = z.object({
  participants: z.array(createParticipantSchema).min(1, 'At least one participant is required'),
  title: z.string().optional(),
  scenario: z.string().optional(), // Custom scenario text override
  scenarioId: z.string().uuid().optional(), // ID of a named scenario from the character's scenarios array
  timestampConfig: TimestampConfigSchema.optional(),
  projectId: z.uuid().optional(),
  imageProfileId: z.uuid().optional(), // Chat-level image profile (shared by all participants)
});

// ============================================================================
// Result Types
// ============================================================================

type ParticipantBuildSuccess = {
  participant: Omit<ChatParticipantBaseInput, 'id' | 'createdAt' | 'updatedAt'>;
  tags: string[];
};
type ParticipantBuildError = { error: string };
type ParticipantBuildResult = ParticipantBuildSuccess | ParticipantBuildError;

type BuildParticipantsResult =
  | {
      participants: Omit<ChatParticipantBaseInput, 'id' | 'createdAt' | 'updatedAt'>[];
      tags: Set<string>;
      firstCharacter: { characterId: string; userCharacterId?: string; selectedSystemPromptId?: string };
      firstImageProfileId: string | null;
    }
  | { error: string };

// ============================================================================
// Helper Functions
// ============================================================================

async function buildCharacterParticipant(
  data: z.infer<typeof createParticipantSchema>,
  displayOrder: number,
  userId: string,
  repos: Repos
): Promise<ParticipantBuildResult> {
  if (!data.characterId) {
    return { error: 'characterId is required for CHARACTER participants' };
  }

  const character = await repos.characters.findById(data.characterId);
  if (character?.userId !== userId) {
    return { error: 'Character not found' };
  }

  const controlledBy = data.controlledBy || character.controlledBy || 'llm';
  const isUserControlled = controlledBy === 'user';

  if (!isUserControlled && !data.connectionProfileId) {
    return { error: 'connectionProfileId is required for LLM-controlled CHARACTER participants' };
  }

  if (data.connectionProfileId) {
    const profile = await repos.connections.findById(data.connectionProfileId);
    if (profile?.userId !== userId) {
      return { error: 'Connection profile not found' };
    }
  }

  if (data.imageProfileId) {
    const imgProfile = await repos.imageProfiles.findById(data.imageProfileId);
    if (imgProfile?.userId !== userId) {
      return { error: 'Image profile not found' };
    }
  }

  return {
    participant: {
      type: 'CHARACTER',
      characterId: data.characterId,
      controlledBy,
      connectionProfileId: isUserControlled ? null : data.connectionProfileId || null,
      imageProfileId: data.imageProfileId || null,
      selectedSystemPromptId: data.selectedSystemPromptId || null,
      displayOrder,
      isActive: true,
    },
    tags: character.tags || [],
  };
}


async function buildAllParticipants(
  participantsData: z.infer<typeof createParticipantSchema>[],
  userId: string,
  repos: Repos
): Promise<BuildParticipantsResult> {
  const builtParticipants: Omit<ChatParticipantBaseInput, 'id' | 'createdAt' | 'updatedAt'>[] = [];
  const allTagIds = new Set<string>();
  let firstLLMCharacter: { characterId: string; userCharacterId?: string; selectedSystemPromptId?: string } | null = null;
  let firstUserCharacterId: string | null = null;
  let firstImageProfileId: string | null = null;

  for (let i = 0; i < participantsData.length; i++) {
    const participantData = participantsData[i];

    const result = await buildCharacterParticipant(participantData, i, userId, repos);
    if ('error' in result) {
      return result;
    }

    builtParticipants.push(result.participant);
    for (const tag of result.tags) {
      allTagIds.add(tag);
    }

    // Collect first imageProfileId from participants (legacy support)
    if (!firstImageProfileId && participantData.imageProfileId) {
      firstImageProfileId = participantData.imageProfileId;
    }

    const isUserControlled = result.participant.controlledBy === 'user';
    if (!isUserControlled && !firstLLMCharacter && participantData.characterId) {
      firstLLMCharacter = {
        characterId: participantData.characterId,
        selectedSystemPromptId: participantData.selectedSystemPromptId || undefined,
      };
    }

    if (isUserControlled && !firstUserCharacterId && participantData.characterId) {
      firstUserCharacterId = participantData.characterId;
    }
  }

  if (!firstLLMCharacter) {
    return { error: 'At least one LLM-controlled CHARACTER participant is required' };
  }

  firstLLMCharacter.userCharacterId = firstUserCharacterId || undefined;

  return { participants: builtParticipants, tags: allTagIds, firstCharacter: firstLLMCharacter, firstImageProfileId };
}

async function createInitialMessages(
  chatId: string,
  context: ChatContext,
  participants: ChatParticipantBaseInput[],
  userId: string,
  repos: Repos,
  projectId?: string | null
): Promise<void> {
  const systemMessage: ChatEvent = {
    type: 'message',
    id: crypto.randomUUID(),
    role: 'SYSTEM',
    content: context.systemPrompt,
    attachments: [],
    createdAt: new Date().toISOString(),
  };
  await repos.chats.addMessage(chatId, systemMessage);

  let firstMessageContent = (context.firstMessage || '').trim();

  if (!firstMessageContent) {
    firstMessageContent = await autoGenerateFirstMessage(context, participants, userId, repos, projectId);
  }

  if (!firstMessageContent) {
    const userName = context.userCharacter?.name;
    firstMessageContent = userName
      ? `Hello, ${userName}! I'm ${context.character.name}. What's on your mind today?`
      : `Hello there! I'm ${context.character.name}. It's great to meet you. What's on your mind today?`;
  }

  const firstCharacterParticipant =
    participants.find(
      (p) => p.type === 'CHARACTER' && p.characterId === context.character.id && p.controlledBy !== 'user'
    ) || participants.find((p) => p.type === 'CHARACTER' && p.controlledBy !== 'user');

  const firstMessage: ChatEvent = {
    type: 'message',
    id: crypto.randomUUID(),
    role: 'ASSISTANT',
    content: firstMessageContent,
    participantId: firstCharacterParticipant?.id || undefined,
    attachments: [],
    createdAt: new Date().toISOString(),
  };
  await repos.chats.addMessage(chatId, firstMessage);}

async function autoGenerateFirstMessage(
  context: ChatContext,
  participants: ChatParticipantBaseInput[],
  userId: string,
  repos: Repos,
  projectId?: string | null
): Promise<string> {
  const participant = participants
    .filter((p) => p.type === 'CHARACTER' && p.characterId === context.character.id)
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))[0] ||
    participants.filter((p) => p.type === 'CHARACTER').sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))[0];

  if (!participant?.connectionProfileId) {
    return '';
  }

  const connectionProfile = await repos.connections.findById(participant.connectionProfileId);
  if (!connectionProfile) {
    return '';
  }

  let apiKey = '';
  if (connectionProfile.apiKeyId) {
    const storedKey = await repos.connections.findApiKeyById(connectionProfile.apiKeyId);
    if (!storedKey) {
      logger.warn('[Chats v1] Connection profile is missing its API key', { context: 'autoGenerateFirstMessage' });
      return '';
    }

    apiKey = storedKey.key_value;
  }

  const rawParameters = connectionProfile.parameters as Record<string, unknown> | undefined;
  const parameters = rawParameters ?? {};

  let participantMemories: { aboutCharacterName: string; summary: string }[] = [];
  let projectContext: { name: string; description?: string | null; instructions?: string | null } | null = null;

  try {
    const chatSettings = await repos.chatSettings.findByUserId(userId);
    const embeddingProfileId = chatSettings?.cheapLLMSettings?.embeddingProfileId;const firstMessageContext = await buildFirstMessageContext(context.character.id, participants, {
      userId,
      projectId,
      embeddingProfileId: embeddingProfileId ?? undefined,
    });

    participantMemories = firstMessageContext.participantMemories.map((m) => ({
      aboutCharacterName: m.aboutCharacterName,
      summary: m.summary,
    }));
    projectContext = firstMessageContext.projectContext;
  } catch (error) {
    logger.error('[Chats v1] Failed to build first message context', {
      characterId: context.character.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const extractNumber = (value: unknown): number | undefined => {
    if (typeof value === 'number' && !Number.isNaN(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
  };

  const baseParams = {
    systemPrompt: context.systemPrompt,
    characterName: context.character.name,
    provider: connectionProfile.provider,
    modelName: connectionProfile.modelName,
    baseUrl: connectionProfile.baseUrl,
    apiKey,
    temperature: extractNumber(parameters.temperature),
    maxTokens: extractNumber(parameters.maxTokens),
    topP: extractNumber(parameters.topP),
  };

  // Track whether any attempt hit a content filter so we can try the Concierge fallback
  let contentFilterHit = false;

  // Attempt 1: Full context (memories + project)
  try {
    const result = await generateGreetingMessage({
      ...baseParams,
      participantMemories: participantMemories.length > 0 ? participantMemories : undefined,
      projectContext,
    });

    if (result.content) {
      return result.content;
    }
    if (result.contentFilterDetected) {
      contentFilterHit = true;
    }
  } catch (error) {
    logger.warn('[Chats v1] Greeting generation attempt failed', {
      characterId: context.character.id,
      attempt: 'full context',
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Attempt 2: Strip memories (they may be triggering content filter)
  if (participantMemories.length > 0) {
    try {
      logger.info('[Chats v1] Retrying greeting generation without memories', {
        characterId: context.character.id,
        originalMemoryCount: participantMemories.length,
      });

      const result = await generateGreetingMessage({
        ...baseParams,
        projectContext,
      });

      if (result.content) {
        logger.info('[Chats v1] Greeting generation succeeded on retry without memories', {
          characterId: context.character.id,
        });
        return result.content;
      }
      if (result.contentFilterDetected) {
        contentFilterHit = true;
      }
    } catch (error) {
      logger.warn('[Chats v1] Greeting generation attempt failed', {
        characterId: context.character.id,
        attempt: 'without memories',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Attempt 3: If content filter was detected, try the Concierge uncensored provider
  if (contentFilterHit) {
    try {
      const chatSettings = await repos.chatSettings.findByUserId(userId);
      const resolved = resolveDangerousContentSettings(chatSettings);

      if (resolved.settings.mode === 'AUTO_ROUTE') {
        const routeResult = await resolveProviderForDangerousContent(
          connectionProfile,
          apiKey,
          resolved.settings,
          userId
        );

        if (routeResult.rerouted) {
          logger.info('[Chats v1] Content filter detected on greeting — falling back to Concierge uncensored provider', {
            characterId: context.character.id,
            uncensoredProfile: routeResult.connectionProfile.name,
            uncensoredProvider: routeResult.connectionProfile.provider,
            uncensoredModel: routeResult.connectionProfile.modelName,
          });

          const uncensoredParams = routeResult.connectionProfile.parameters as Record<string, unknown> | undefined;
          const uncensoredParameters = uncensoredParams ?? {};

          const result = await generateGreetingMessage({
            systemPrompt: context.systemPrompt,
            characterName: context.character.name,
            provider: routeResult.connectionProfile.provider,
            modelName: routeResult.connectionProfile.modelName,
            baseUrl: routeResult.connectionProfile.baseUrl,
            apiKey: routeResult.apiKey,
            temperature: extractNumber(uncensoredParameters.temperature) ?? extractNumber(parameters.temperature),
            maxTokens: extractNumber(uncensoredParameters.maxTokens) ?? extractNumber(parameters.maxTokens),
            topP: extractNumber(uncensoredParameters.topP) ?? extractNumber(parameters.topP),
            participantMemories: participantMemories.length > 0 ? participantMemories : undefined,
            projectContext,
          });

          if (result.content) {
            logger.info('[Chats v1] Greeting generation succeeded via Concierge uncensored provider', {
              characterId: context.character.id,
              provider: routeResult.connectionProfile.provider,
              model: routeResult.connectionProfile.modelName,
            });
            return result.content;
          }
        }
      }
    } catch (error) {
      logger.warn('[Chats v1] Concierge fallback for greeting generation failed', {
        characterId: context.character.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Attempt 4: Final plain retry with delay for transient failures
  try {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const result = await generateGreetingMessage({ ...baseParams });

    if (result.content) {
      logger.info('[Chats v1] Greeting generation succeeded on final retry', {
        characterId: context.character.id,
      });
      return result.content;
    }
  } catch (error) {
    logger.warn('[Chats v1] Final greeting generation retry failed', {
      characterId: context.character.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.warn('[Chats v1] All greeting generation attempts exhausted, falling back to static greeting', {
    characterId: context.character.id,
    contentFilterHit,
  });
  return '';
}

// ============================================================================
// Handler Functions
// ============================================================================

/**
 * List chats
 */
async function handleList(req: NextRequest, context: AuthenticatedContext) {
  const { user, repos } = context;

  try {
    const { searchParams } = req.nextUrl;
    const excludeTagIdsParam = searchParams.get('excludeTagIds');
    const limitParam = searchParams.get('limit');
    const excludeTagIds = excludeTagIdsParam ? excludeTagIdsParam.split(',').filter(Boolean) : [];
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;
    const allChatMetadata = await repos.chats.findByUserId(user.id);
    // Filter out help chats from salon listing
    const chatMetadata = allChatMetadata.filter((c: any) => !c.chatType || c.chatType === 'salon');
    const enrichedChats = await enrichChatsForList(chatMetadata, repos);
    let filteredChats = filterChatsByExcludedTags(enrichedChats, excludeTagIds);

    if (limit && limit > 0) {
      filteredChats = filteredChats.slice(0, limit);
    }

    const result = cleanEnrichedChats(filteredChats);

    return NextResponse.json({ chats: result });
  } catch (error) {
    logger.error('[Chats v1] Error listing chats', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch chats');
  }
}

/**
 * Check if any dangerous chats exist for the current user
 */
async function handleHasDangerous(context: AuthenticatedContext) {
  const { user, repos } = context;

  try {
    const allChats = await repos.chats.findByUserId(user.id);
    const hasDangerous = allChats.some((c: any) => c.isDangerousChat === true);
    return NextResponse.json({ hasDangerous });
  } catch (error) {
    logger.error('[Chats v1] Error checking dangerous chats', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to check dangerous chats');
  }
}

/**
 * Create chat
 */
async function handleCreate(req: NextRequest, context: AuthenticatedContext) {
  const { user, repos } = context;

  try {
    const body = await req.json();
    const validatedData = createChatSchema.parse(body);

    const buildResult = await buildAllParticipants(validatedData.participants, user.id, repos);
    if ('error' in buildResult) {
      return badRequest(buildResult.error);
    }

    // Resolve scenario: custom text takes priority, then scenarioId lookup, then nothing
    let resolvedScenario = validatedData.scenario;
    if (!resolvedScenario && validatedData.scenarioId) {
      const characterForScenario = await repos.characters.findById(buildResult.firstCharacter.characterId);
      const matchingScenario = characterForScenario?.scenarios?.find(s => s.id === validatedData.scenarioId);
      if (matchingScenario) {
        resolvedScenario = matchingScenario.content;
        logger.debug('[Chats v1] Resolved scenarioId to scenario content', {
          characterId: buildResult.firstCharacter.characterId,
          scenarioId: validatedData.scenarioId,
          scenarioTitle: matchingScenario.title,
        });
      } else {
        logger.warn('[Chats v1] scenarioId not found on character', {
          characterId: buildResult.firstCharacter.characterId,
          scenarioId: validatedData.scenarioId,
        });
      }
    }

    const chatContext = await buildChatContext(
      buildResult.firstCharacter.characterId,
      buildResult.firstCharacter.userCharacterId,
      resolvedScenario,
      buildResult.firstCharacter.selectedSystemPromptId
    );

    const chatSettings = await repos.chatSettings.findByUserId(user.id);
    const defaultRoleplayTemplateId = chatSettings?.defaultRoleplayTemplateId || null;const now = new Date().toISOString();
    const participantsWithTimestamps: ChatParticipantBaseInput[] = buildResult.participants.map((p) => ({
      ...p,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }));

    // Default tool settings from project (if creating chat within a project)
    let projectToolDefaults = {
      disabledTools: [] as string[],
      disabledToolGroups: [] as string[],
    };

    if (validatedData.projectId) {
      const project = await repos.projects.findById(validatedData.projectId);
      if (!project || project.userId !== user.id) {
        return notFound('Project');
      }

      // Extract default tool settings from project
      projectToolDefaults = {
        disabledTools: project.defaultDisabledTools || [],
        disabledToolGroups: project.defaultDisabledToolGroups || [],
      };

      if (!project.allowAnyCharacter) {
        const characterIds = participantsWithTimestamps
          .filter((p) => p.type === 'CHARACTER' && p.characterId)
          .map((p) => p.characterId as string);

        const newCharacterIds = characterIds.filter((id) => !project.characterRoster.includes(id));
        if (newCharacterIds.length > 0) {
          await repos.projects.update(validatedData.projectId, {
            characterRoster: [...project.characterRoster, ...newCharacterIds],
          });
        }
      }
    }

    // Use chat-level imageProfileId if provided, otherwise use first from participants (legacy support)
    const chatImageProfileId = validatedData.imageProfileId || buildResult.firstImageProfileId || null;

    const chat = await repos.chats.create({
      userId: user.id,
      participants: participantsWithTimestamps,
      title: validatedData.title || `Chat with ${chatContext.character.name}`,
      contextSummary: validatedData.scenario || null,
      tags: Array.from(buildResult.tags),
      roleplayTemplateId: defaultRoleplayTemplateId,
      timestampConfig: validatedData.timestampConfig || chatSettings?.defaultTimestampConfig || null,
      messageCount: 0,
      lastMessageAt: null,
      lastRenameCheckInterchange: 0,
      projectId: validatedData.projectId || null,
      disabledTools: projectToolDefaults.disabledTools,
      disabledToolGroups: projectToolDefaults.disabledToolGroups,
      imageProfileId: chatImageProfileId,
    });

    await createInitialMessages(
      chat.id,
      chatContext,
      participantsWithTimestamps,
      user.id,
      repos,
      validatedData.projectId || null
    );

    const enrichedParticipants = await Promise.all(
      chat.participants.map((p) => enrichParticipantSummary(p, repos))
    );

    logger.info('[Chats v1] Chat created', { chatId: chat.id });

    return NextResponse.json({ chat: { ...chat, participants: enrichedParticipants } }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Chats v1] Error creating chat', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to create chat');
  }
}

/**
 * Import chat (SillyTavern format)
 */
async function handleImport(req: NextRequest, context: AuthenticatedContext) {
  const { user, repos } = context;

  try {
    const body = await req.json();

    // Detect which mode we're in based on request body
    if (body.mappings) {
      // Multi-character mode
      if (!body.chatData || !body.mappings || body.mappings.length === 0) {
        return badRequest('Chat data and mappings are required');
      }

      const options: MultiCharacterImportOptions = {
        chatData: body.chatData,
        mappings: body.mappings,
        defaultConnectionProfileId: body.defaultConnectionProfileId,
        triggerTitleGeneration: body.triggerTitleGeneration,
        createMemories: body.createMemories,
        title: body.title,
      };

      try {
        const result = await importMultiCharacterChat(user.id, options, repos);

        return NextResponse.json(
          {
            ...result.chat,
            createdEntities: result.createdEntities,
            triggerTitleGeneration: options.triggerTitleGeneration || false,
            memoryJobCount: result.memoryJobCount,
          },
          { status: 201 }
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (errorMessage.includes('not found') || errorMessage.includes('At least one character')) {
          return badRequest(errorMessage);
        }

        throw error;
      }
    } else {
      // Legacy single-character mode
      if (!body.chatData || !body.characterId || !body.connectionProfileId) {
        return badRequest('Chat data, character ID, and connection profile ID are required');
      }

      const options: LegacyImportOptions = {
        chatData: body.chatData,
        characterId: body.characterId,
        connectionProfileId: body.connectionProfileId,
        title: body.title,
      };

      try {
        const result = await importLegacyChat(user.id, options, repos);

        const character = result.chat.participants.find((p) => p.type === 'CHARACTER')?.character;

        return NextResponse.json(
          {
            ...result.chat,
            character,
            connectionProfile: { id: body.connectionProfileId },
          },
          { status: 201 }
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (errorMessage.includes('not found')) {
          return notFound('Resource');
        }

        throw error;
      }
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Failed to import chat');
    logger.error('[Chats v1] Error importing chat', { errorMessage }, error instanceof Error ? error : undefined);
    return serverError(errorMessage);
  }
}

// ============================================================================
// Route Handlers
// ============================================================================

/**
 * GET /api/v1/chats - Action dispatch or list
 */
export const GET = createAuthenticatedHandler(async (req, context) => {
  const action = getActionParam(req);

  if (!action) {
    return handleList(req, context);
  }

  if (!isValidAction(action, CHAT_GET_ACTIONS)) {
    return badRequest(`Unknown action: ${action}. Available actions: ${CHAT_GET_ACTIONS.join(', ')}`);
  }

  const actionHandlers: Record<ChatGetAction, () => Promise<NextResponse>> = {
    'has-dangerous': () => handleHasDangerous(context),
  };

  return actionHandlers[action]();
});

/**
 * POST /api/v1/chats - Action dispatch or create
 */
export const POST = createAuthenticatedHandler(async (req, context) => {
  const action = getActionParam(req);

  if (!action) {
    return handleCreate(req, context);
  }

  if (!isValidAction(action, CHAT_POST_ACTIONS)) {
    return badRequest(`Unknown action: ${action}. Available actions: ${CHAT_POST_ACTIONS.join(', ')}`);
  }

  const actionHandlers: Record<ChatPostAction, () => Promise<NextResponse>> = {
    import: () => handleImport(req, context),
  };

  return actionHandlers[action]();
});
