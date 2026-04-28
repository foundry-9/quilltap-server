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
import { buildRecentConversationsBlock, calculateRecentConversationsLimit } from '@/lib/memory/memory-recap';
import { getModelContextLimit } from '@/lib/llm/model-context-data';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/errors';
import { z } from 'zod';
import type { ChatEvent, ChatParticipantBaseInput, TimestampConfig } from '@/lib/schemas/types';
import { TimestampConfigSchema } from '@/lib/schemas/types';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import {
  OutfitSelectionSchema,
  EMPTY_EQUIPPED_SLOTS,
  type EquippedSlots,
  type OutfitSelection,
  type WardrobeItem,
} from '@/lib/schemas/wardrobe.types';
import { getCheapLLMProvider, DEFAULT_CHEAP_LLM_CONFIG, type CheapLLMConfig } from '@/lib/llm/cheap-llm';
import { chooseLLMOutfit } from '@/lib/memory/cheap-llm-tasks/outfit-selection';
import { notFound, badRequest, serverError } from '@/lib/api/responses';
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
import {
  postHostAddAnnouncement,
  postHostScenarioAnnouncement,
  postHostUserCharacterAnnouncement,
} from '@/lib/services/host-notifications/writer';
import { postOpeningOutfitWhisper } from '@/lib/services/aurora-notifications/writer';
import { postProsperoProjectContextAnnouncement } from '@/lib/services/prospero-notifications/writer';
import { compileAllIdentityStacks } from '@/lib/services/system-prompt-compiler/compiler';

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
  scenario: z.string().optional(), // Custom scenario text override (highest precedence)
  scenarioId: z.string().uuid().optional(), // ID of a named scenario from the character's scenarios array
  /**
   * Relative path of a project scenario file (`Scenarios/<filename>.md`) inside the
   * project's official document store. Server resolves the body from frontmatter +
   * markdown and bakes it into `chat.scenarioText`. Lower precedence than `scenario`
   * and `scenarioId`. Requires `projectId` to also be set.
   */
  projectScenarioPath: z.string().max(500).optional(),
  timestampConfig: TimestampConfigSchema.optional(),
  projectId: z.uuid().optional(),
  imageProfileId: z.uuid().optional(), // Chat-level image profile (shared by all participants)
  outfitSelections: z.array(OutfitSelectionSchema).optional(), // Per-character outfit selections for chat start
  avatarGenerationEnabled: z.boolean().optional(), // Enable auto-generated character avatars on outfit changes
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
  if (!character) {
    return { error: 'Character not found' };
  }

  const controlledBy = data.controlledBy || character.controlledBy || 'llm';
  const isUserControlled = controlledBy === 'user';

  if (!isUserControlled && !data.connectionProfileId) {
    return { error: 'connectionProfileId is required for LLM-controlled CHARACTER participants' };
  }

  if (data.connectionProfileId) {
    const profile = await repos.connections.findById(data.connectionProfileId);
    if (!profile) {
      return { error: 'Connection profile not found' };
    }
  }

  if (data.imageProfileId) {
    const imgProfile = await repos.imageProfiles.findById(data.imageProfileId);
    if (!imgProfile) {
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

// ============================================================================
// Outfit Resolution Helpers
// ============================================================================

/**
 * Resolve the default outfit for a character from their wardrobe items marked as default.
 * Maps each default item's coverage types to the corresponding equipped slot.
 * If multiple items cover the same slot, the first one found wins.
 */
async function resolveDefaultOutfit(characterId: string, repos: Repos): Promise<EquippedSlots> {
  const defaultItems = await repos.wardrobe.findDefaultsForCharacter(characterId);

  if (defaultItems.length === 0) {
    logger.debug('[Chats v1] No default wardrobe items found for character', { characterId });
    return { ...EMPTY_EQUIPPED_SLOTS };
  }

  const slots: EquippedSlots = { ...EMPTY_EQUIPPED_SLOTS };

  for (const item of defaultItems) {
    for (const slotType of item.types) {
      if (slotType in slots && slots[slotType as keyof EquippedSlots] === null) {
        slots[slotType as keyof EquippedSlots] = item.id;
      }
    }
  }

  logger.debug('[Chats v1] Resolved default outfit for character', {
    characterId,
    defaultItemCount: defaultItems.length,
    slots,
  });

  return slots;
}

/**
 * Context needed for LLM-based outfit selection during chat creation.
 */
interface OutfitSelectionContext {
  userId: string;
  scenarioText?: string | null;
  cheapLLMConfig?: CheapLLMConfig;
}

/**
 * Apply outfit selections to a newly created chat.
 * Processes each selection based on its mode:
 * - 'default': Load default wardrobe items and map to slots
 * - 'manual': Use the provided slot assignments directly
 * - 'none': Set all slots to null (EMPTY_EQUIPPED_SLOTS)
 * - 'llm_choose': Ask a cheap LLM to pick an outfit, fall back to defaults on failure
 */
async function applyOutfitSelections(
  chatId: string,
  selections: OutfitSelection[],
  repos: Repos,
  context?: OutfitSelectionContext,
): Promise<void> {
  for (const selection of selections) {
    const { characterId, mode } = selection;

    switch (mode) {
      case 'default': {
        const slots = await resolveDefaultOutfit(characterId, repos);
        await repos.chats.setEquippedOutfit(chatId, characterId, slots);
        logger.debug('[Chats v1] Applied default outfit for character', { chatId, characterId });
        break;
      }

      case 'manual': {
        const slots = selection.slots || EMPTY_EQUIPPED_SLOTS;
        await repos.chats.setEquippedOutfit(chatId, characterId, slots);
        logger.debug('[Chats v1] Applied manual outfit for character', { chatId, characterId, slots });
        break;
      }

      case 'none': {
        await repos.chats.setEquippedOutfit(chatId, characterId, { ...EMPTY_EQUIPPED_SLOTS });
        logger.debug('[Chats v1] Applied empty outfit for character', { chatId, characterId });
        break;
      }

      case 'llm_choose': {
        // Ask a cheap LLM to pick an outfit based on character + scenario context
        // Falls back to default outfit on any failure
        let applied = false;

        if (context) {
          try {
            const character = await repos.characters.findById(characterId);
            const wardrobeItems = await repos.wardrobe.findByCharacterId(characterId);

            if (character && wardrobeItems.length > 0) {
              // Get a cheap LLM provider for the selection task
              const allProfiles = await repos.connections.findAll();
              const defaultProfile = allProfiles.find(p => p.isDefault) || allProfiles[0];

              if (defaultProfile) {
                const cheapSelection = getCheapLLMProvider(
                  defaultProfile,
                  context.cheapLLMConfig || DEFAULT_CHEAP_LLM_CONFIG,
                  allProfiles,
                  false, // ollamaAvailable
                );

                logger.debug('[Chats v1] Requesting LLM outfit selection', {
                  chatId,
                  characterId,
                  characterName: character.name,
                  wardrobeItemCount: wardrobeItems.length,
                  provider: cheapSelection.provider,
                  model: cheapSelection.modelName,
                });

                const result = await chooseLLMOutfit(
                  character.name,
                  character.personality || null,
                  wardrobeItems,
                  context.scenarioText || null,
                  cheapSelection,
                  context.userId,
                  chatId,
                );

                if (result.success && result.result) {
                  await repos.chats.setEquippedOutfit(chatId, characterId, result.result);
                  applied = true;
                  logger.debug('[Chats v1] Applied LLM-chosen outfit for character', {
                    chatId,
                    characterId,
                    slots: result.result,
                  });
                } else {
                  logger.warn('[Chats v1] LLM outfit selection failed, falling back to defaults', {
                    chatId,
                    characterId,
                    error: result.error,
                  });
                }
              }
            }
          } catch (error) {
            logger.warn('[Chats v1] Error during LLM outfit selection, falling back to defaults', {
              chatId,
              characterId,
              error: getErrorMessage(error, 'Unknown error'),
            });
          }
        }

        // Fallback: use default outfit if LLM selection failed or wasn't attempted
        if (!applied) {
          const slots = await resolveDefaultOutfit(characterId, repos);
          await repos.chats.setEquippedOutfit(chatId, characterId, slots);
          logger.debug('[Chats v1] Applied default outfit as fallback for llm_choose', { chatId, characterId });
        }
        break;
      }

      default:
        logger.warn('[Chats v1] Unknown outfit selection mode', { chatId, characterId, mode });
        break;
    }
  }
}

async function createInitialMessages(
  chatId: string,
  context: ChatContext,
  participants: ChatParticipantBaseInput[],
  userId: string,
  repos: Repos,
  projectId?: string | null,
  scenarioText?: string | null,
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

  // Phase E: emit Prospero project-context whisper at chat-start when a
  // project is attached and has description/instructions. Replaces the
  // per-turn `## Project Context` block previously injected via the system
  // prompt. The cadence-based re-injection (every N messages) is handled by
  // the orchestrator.
  if (projectId) {
    try {
      const project = await repos.projects.findById(projectId);
      if (project && (project.description || project.instructions)) {
        await postProsperoProjectContextAnnouncement({
          chatId,
          project: {
            name: project.name,
            description: project.description,
            instructions: project.instructions,
          },
        });
      }
    } catch (error) {
      logger.warn('[Chats v1] Failed to post chat-start Prospero project-context whisper', {
        chatId,
        projectId,
        error: getErrorMessage(error, 'Unknown error'),
      });
    }
  }

  // Phase C: emit Host whispers establishing the opening state — scenario,
  // user-character intro, and (in multi-character chats) a welcome for each
  // LLM-controlled character so the others learn about them. These replace
  // the corresponding sections that previously lived in the per-turn system
  // prompt.
  if (scenarioText && scenarioText.trim().length > 0) {
    await postHostScenarioAnnouncement({ chatId, scenarioText });
  }

  if (context.userCharacter) {
    await postHostUserCharacterAnnouncement({
      chatId,
      userCharacterName: context.userCharacter.name,
      userCharacterDescription: context.userCharacter.description ?? null,
    });
  }

  const llmCharacterParticipants = participants.filter(
    (p) => p.type === 'CHARACTER' && p.controlledBy !== 'user' && p.characterId,
  );
  if (llmCharacterParticipants.length > 1) {
    for (const participant of llmCharacterParticipants) {
      const character = await repos.characters.findById(participant.characterId as string);
      if (character) {
        await postHostAddAnnouncement({
          chatId,
          character,
          participantId: participant.id,
          initialStatus: participant.status,
        });
      }
    }
  }

  // Phase D: Aurora establishes how each LLM-controlled character is dressed
  // at the opening of the chat. Replaces the per-turn `## Current Outfit` /
  // `## Available Wardrobe` blocks. Outfit selection has already been applied
  // by handleCreate before this runs, so equippedOutfit is populated.
  for (const participant of llmCharacterParticipants) {
    try {
      const characterId = participant.characterId as string;
      const character = await repos.characters.findById(characterId);
      if (!character) continue;

      const equippedSlots = await repos.chats.getEquippedOutfitForCharacter(chatId, characterId);
      if (!equippedSlots) continue;

      const equippedItemIds = Object.values(equippedSlots).filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      );
      const equippedItemsData = equippedItemIds.length > 0
        ? await repos.wardrobe.findByIds(equippedItemIds)
        : [];
      const equippedItemsMap = new Map(equippedItemsData.map((item) => [item.id, item]));

      const titleFor = (slot: keyof typeof equippedSlots): string | null => {
        const id = equippedSlots[slot];
        if (!id) return null;
        return equippedItemsMap.get(id)?.title ?? null;
      };

      const outfit = {
        top: titleFor('top'),
        bottom: titleFor('bottom'),
        footwear: titleFor('footwear'),
        accessories: titleFor('accessories'),
      };

      const allWardrobeItems = await repos.wardrobe.findByCharacterId(characterId);
      const equippedIdSet = new Set(equippedItemIds);
      const availableItems = allWardrobeItems
        .filter((w) => !equippedIdSet.has(w.id))
        .map((w) => ({ title: w.title }));

      await postOpeningOutfitWhisper({
        chatId,
        characterName: character.name,
        outfit,
        availableItems,
      });
    } catch (error) {
      logger.warn('[Chats v1] Failed to post opening outfit whisper', {
        chatId,
        characterId: participant.characterId,
        error: getErrorMessage(error, 'Unknown error'),
      });
    }
  }

  let firstMessageContent = (context.firstMessage || '').trim();

  if (!firstMessageContent) {
    firstMessageContent = await autoGenerateFirstMessage(chatId, context, participants, userId, repos, projectId);
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
  chatId: string,
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
    const firstMessageContext = await buildFirstMessageContext(context.character.id, participants, {
      userId,
      projectId,
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

  // Compute the Recent Conversations block once and reuse across retry attempts.
  // The new chat has no contextSummary yet, so excluding it is defensive only.
  let recentConversationsBlock = '';
  try {
    const maxContext =
      connectionProfile.maxContext ??
      getModelContextLimit(connectionProfile.provider, connectionProfile.modelName);
    const limit = calculateRecentConversationsLimit(maxContext);
    recentConversationsBlock = await buildRecentConversationsBlock(
      context.character.id,
      chatId,
      limit
    );
  } catch (error) {
    logger.warn('[Chats v1] Failed to build recent-conversations block for greeting', {
      characterId: context.character.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const loggingFields = {
    userId,
    chatId,
    characterId: context.character.id,
  };

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
      ...loggingFields,
      participantMemories: participantMemories.length > 0 ? participantMemories : undefined,
      projectContext,
      recentConversationsBlock: recentConversationsBlock || undefined,
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
        ...loggingFields,
        projectContext,
        recentConversationsBlock: recentConversationsBlock || undefined,
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
            ...loggingFields,
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
            recentConversationsBlock: recentConversationsBlock || undefined,
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
    const result = await generateGreetingMessage({ ...baseParams, ...loggingFields });

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

  const body = await req.json();
  const validatedData = createChatSchema.parse(body);

  const buildResult = await buildAllParticipants(validatedData.participants, user.id, repos);
  if ('error' in buildResult) {
    return badRequest(buildResult.error);
  }

  // Fetch the primary character for defaults resolution
  const primaryCharacter = await repos.characters.findById(buildResult.firstCharacter.characterId);

  // Resolve scenario: custom text > character scenarioId > project scenario path > nothing
  let resolvedScenario = validatedData.scenario;
  if (!resolvedScenario && validatedData.scenarioId) {
    const matchingScenario = primaryCharacter?.scenarios?.find(s => s.id === validatedData.scenarioId);
    if (matchingScenario) {
      resolvedScenario = matchingScenario.content;
    } else {
      logger.warn('[Chats v1] scenarioId not found on character', {
        characterId: buildResult.firstCharacter.characterId,
        scenarioId: validatedData.scenarioId,
      });
    }
  }
  if (!resolvedScenario && validatedData.projectScenarioPath) {
    if (!validatedData.projectId) {
      logger.warn('[Chats v1] projectScenarioPath provided without projectId; ignoring', {
        projectScenarioPath: validatedData.projectScenarioPath,
      });
    } else {
      const project = await repos.projects.findById(validatedData.projectId);
      if (!project?.officialMountPointId) {
        logger.warn('[Chats v1] projectScenarioPath provided but project has no officialMountPointId', {
          projectId: validatedData.projectId,
          projectScenarioPath: validatedData.projectScenarioPath,
        });
      } else {
        const { resolveProjectScenarioBody } = await import('@/lib/mount-index/project-scenarios');
        const body = await resolveProjectScenarioBody(
          project.officialMountPointId,
          validatedData.projectScenarioPath,
        );
        if (body) {
          resolvedScenario = body;
        } else {
          logger.warn('[Chats v1] projectScenarioPath did not resolve to a body', {
            projectId: validatedData.projectId,
            projectScenarioPath: validatedData.projectScenarioPath,
          });
        }
      }
    }
  }

  const chatContext = await buildChatContext(
    buildResult.firstCharacter.characterId,
    buildResult.firstCharacter.userCharacterId,
    resolvedScenario,
    buildResult.firstCharacter.selectedSystemPromptId
  );

  const chatSettings = await repos.chatSettings.findByUserId(user.id);
  const defaultRoleplayTemplateId = chatSettings?.defaultRoleplayTemplateId || null;
  const now = new Date().toISOString();
  const participantsWithTimestamps: ChatParticipantBaseInput[] = buildResult.participants.map((p) => ({
    ...p,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  }));

  // Default tool settings and avatar generation from project (if creating chat within a project)
  let projectToolDefaults = {
    disabledTools: [] as string[],
    disabledToolGroups: [] as string[],
  };
  let projectAvatarGenerationDefault: boolean | null = null;
  let projectDefaultImageProfileId: string | null = null;

  if (validatedData.projectId) {
    const project = await repos.projects.findById(validatedData.projectId);
    if (!project) {
      return notFound('Project');
    }

    // Extract default tool settings from project
    projectToolDefaults = {
      disabledTools: project.defaultDisabledTools || [],
      disabledToolGroups: project.defaultDisabledToolGroups || [],
    };
    projectAvatarGenerationDefault = project.defaultAvatarGenerationEnabled ?? null;
    projectDefaultImageProfileId = project.defaultImageProfileId ?? null;

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

  // Resolve timestamp config with fallback chain: request > character default > global default
  const resolvedTimestampConfig = validatedData.timestampConfig || primaryCharacter?.defaultTimestampConfig || chatSettings?.defaultTimestampConfig || null;

  // Resolve image profile: request > project default > character default > null
  const chatImageProfileId = validatedData.imageProfileId || projectDefaultImageProfileId || buildResult.firstImageProfileId || null;

  const chat = await repos.chats.create({
    userId: user.id,
    participants: participantsWithTimestamps,
    title: validatedData.title || `Chat with ${chatContext.character.name}`,
    contextSummary: validatedData.scenario || null,
    tags: Array.from(buildResult.tags),
    roleplayTemplateId: defaultRoleplayTemplateId,
    timestampConfig: resolvedTimestampConfig,
    messageCount: 0,
    lastMessageAt: null,
    lastRenameCheckInterchange: 0,
    projectId: validatedData.projectId || null,
    scenarioText: resolvedScenario || null,
    disabledTools: projectToolDefaults.disabledTools,
    disabledToolGroups: projectToolDefaults.disabledToolGroups,
    imageProfileId: chatImageProfileId,
    avatarGenerationEnabled: validatedData.avatarGenerationEnabled ?? projectAvatarGenerationDefault ?? null,
    documentEditingMode: chatSettings?.compositionModeDefault ?? false,
  });

  // Apply outfit selections to the newly created chat
  // If no selections provided, apply 'default' mode for all LLM-controlled participants
  // Build cheap LLM config from chat settings for outfit selection
  const cheapLLMConfig: CheapLLMConfig = chatSettings?.cheapLLMSettings
    ? {
      ...DEFAULT_CHEAP_LLM_CONFIG,
      strategy: chatSettings.cheapLLMSettings.strategy,
      fallbackToLocal: chatSettings.cheapLLMSettings.fallbackToLocal,
      userDefinedProfileId: chatSettings.cheapLLMSettings.userDefinedProfileId ?? undefined,
      defaultCheapProfileId: chatSettings.cheapLLMSettings.defaultCheapProfileId ?? undefined,
    }
    : DEFAULT_CHEAP_LLM_CONFIG;
  const outfitContext: OutfitSelectionContext = {
    userId: user.id,
    scenarioText: resolvedScenario,
    cheapLLMConfig,
  };
  try {
    if (validatedData.outfitSelections && validatedData.outfitSelections.length > 0) {
      // Apply explicit selections, then backfill defaults for any participants not covered
      const explicitCharacterIds = new Set(validatedData.outfitSelections.map((s) => s.characterId));
      const missingCharacterIds = participantsWithTimestamps
        .filter((p) => p.type === 'CHARACTER' && p.characterId && !explicitCharacterIds.has(p.characterId))
        .map((p) => p.characterId as string);

      const allSelections: OutfitSelection[] = [
        ...validatedData.outfitSelections,
        ...missingCharacterIds.map((characterId) => ({
          characterId,
          mode: 'default' as const,
        })),
      ];

      await applyOutfitSelections(chat.id, allSelections, repos, outfitContext);
      logger.debug('[Chats v1] Applied outfit selections (explicit + defaults for uncovered participants)', {
        chatId: chat.id,
        explicitCount: validatedData.outfitSelections.length,
        defaultBackfillCount: missingCharacterIds.length,
      });
    } else {
      // Default behavior: apply default outfits for all character participants (LLM and user-controlled)
      const allCharacterIds = participantsWithTimestamps
        .filter((p) => p.type === 'CHARACTER' && p.characterId)
        .map((p) => p.characterId as string);

      if (allCharacterIds.length > 0) {
        const defaultSelections: OutfitSelection[] = allCharacterIds.map((characterId) => ({
          characterId,
          mode: 'default' as const,
        }));
        await applyOutfitSelections(chat.id, defaultSelections, repos, outfitContext);
        logger.debug('[Chats v1] Applied default outfit selections for all participants', {
          chatId: chat.id,
          characterIds: allCharacterIds,
        });
      }
    }
  } catch (error) {
    // Outfit selection failure should not prevent chat creation
    logger.error('[Chats v1] Failed to apply outfit selections', {
      chatId: chat.id,
      error: getErrorMessage(error, 'Unknown outfit selection error'),
    });
  }

  // Phase H: precompile the per-participant identity stack for the new chat
  // so the per-turn buildSystemPrompt can hit the cache from the very first
  // user message. Failure to compile is non-fatal — buildSystemPrompt's
  // read-through fallback rebuilds fresh on miss.
  try {
    await compileAllIdentityStacks(chat);
  } catch (error) {
    logger.warn('[Chats v1] Failed to compile identity stacks at chat creation', {
      chatId: chat.id,
      error: getErrorMessage(error, 'Unknown error'),
    });
  }

  await createInitialMessages(
    chat.id,
    chatContext,
    participantsWithTimestamps,
    user.id,
    repos,
    validatedData.projectId || null,
    resolvedScenario || null,
  );

  const enrichedParticipants = await Promise.all(
    chat.participants.map((p) => enrichParticipantSummary(p, repos))
  );

  logger.info('[Chats v1] Chat created', { chatId: chat.id });

  return NextResponse.json({ chat: { ...chat, participants: enrichedParticipants } }, { status: 201 });
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
