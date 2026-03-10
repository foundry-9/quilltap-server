/**
 * Scene State Tracking Job Handler
 *
 * Handles SCENE_STATE_TRACKING background jobs by deriving a structured
 * summary of the current scene: location, character actions, appearance, and clothing.
 * Uses the cheap LLM (or uncensored fallback for dangerous chats).
 */

import { BackgroundJob, MessageEvent } from '@/lib/schemas/types';
import { SceneStateSchema } from '@/lib/schemas/chat.types';
import { getRepositories } from '@/lib/repositories/factory';
import { getCheapLLMProvider, CheapLLMConfig, type CheapLLMSelection } from '@/lib/llm/cheap-llm';
import { updateSceneState, extractVisibleConversation } from '@/lib/memory/cheap-llm-tasks';
import { createSystemEvent } from '@/lib/services/system-events.service';
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service';
import { classifyContent } from '@/lib/services/dangerous-content/gatekeeper.service';
import { createServiceLogger } from '@/lib/logging/create-logger';
import type { SceneStateTrackingPayload } from '../queue-service';

const logger = createServiceLogger('SceneStateTrackingHandler');

export async function handleSceneStateTracking(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as SceneStateTrackingPayload;
  const repos = getRepositories();

  // 1. Load chat
  const chat = await repos.chats.findById(payload.chatId);
  if (!chat) {
    logger.warn('[SceneStateTracking] Chat not found, skipping', { jobId: job.id, chatId: payload.chatId });
    return;
  }

  // 2. Load characters
  const characters = await Promise.all(
    payload.characterIds.map(id => repos.characters.findById(id))
  );
  const validCharacters = characters.filter(c => c !== null);

  // 3. Get chat settings for cheap LLM
  const chatSettings = await repos.chatSettings.findByUserId(job.userId);
  const availableProfiles = await repos.connections.findByUserId(job.userId);

  // 4. Get connection profile (with fallback)
  let connectionProfile = await repos.connections.findById(payload.connectionProfileId);
  if (!connectionProfile) {
    logger.warn('[SceneStateTracking] Connection profile not found, trying fallback', {
      jobId: job.id, chatId: payload.chatId, connectionProfileId: payload.connectionProfileId,
    });
    if (availableProfiles.length > 0) {
      connectionProfile = availableProfiles[0];
    } else {
      logger.warn('[SceneStateTracking] No available connection profiles, skipping', { jobId: job.id, chatId: payload.chatId });
      return;
    }
  }

  // 5. Get cheap LLM selection
  const cheapLLMConfig: CheapLLMConfig = {
    strategy: chatSettings?.cheapLLMSettings?.strategy || 'PROVIDER_CHEAPEST',
    userDefinedProfileId: chatSettings?.cheapLLMSettings?.userDefinedProfileId || undefined,
    defaultCheapProfileId: chatSettings?.cheapLLMSettings?.defaultCheapProfileId || undefined,
    fallbackToLocal: chatSettings?.cheapLLMSettings?.fallbackToLocal ?? true,
  };

  const isDangerousChat = chat.isDangerousChat === true;
  let cheapLLMSelection = getCheapLLMProvider(connectionProfile, cheapLLMConfig, availableProfiles, false);

  // Build uncensored LLM selection if configured
  let uncensoredLLMSelection: CheapLLMSelection | null = null;
  const uncensoredProfileId = chatSettings?.cheapLLMSettings?.imagePromptProfileId;
  if (uncensoredProfileId) {
    const uncensoredProfile = availableProfiles.find(p => p.id === uncensoredProfileId);
    if (uncensoredProfile) {
      const isLocal = uncensoredProfile.provider === 'OLLAMA';
      uncensoredLLMSelection = {
        provider: uncensoredProfile.provider,
        modelName: uncensoredProfile.modelName,
        connectionProfileId: uncensoredProfile.id,
        baseUrl: isLocal ? (uncensoredProfile.baseUrl || 'http://localhost:11434') : undefined,
        isLocal,
      };
    }
  }

  // Route to uncensored provider if the chat is already flagged dangerous
  if (isDangerousChat && uncensoredLLMSelection) {
    cheapLLMSelection = uncensoredLLMSelection;
    logger.debug('[SceneStateTracking] Using uncensored provider for dangerous chat', {
      jobId: job.id, chatId: payload.chatId, provider: uncensoredLLMSelection.provider,
    });
  }

  // 6. Parse previous scene state if it exists
  let previousSceneState: Record<string, unknown> | null = null;
  let lastUpdateMessageCount = 0;
  if (chat.sceneState) {
    try {
      const parsed = typeof chat.sceneState === 'string' ? JSON.parse(chat.sceneState) : chat.sceneState;
      const validated = SceneStateSchema.safeParse(parsed);
      if (validated.success) {
        previousSceneState = parsed;
        lastUpdateMessageCount = validated.data.updatedAtMessageCount;
      }
    } catch {
      logger.debug('[SceneStateTracking] Failed to parse existing scene state, treating as first turn', {
        jobId: job.id, chatId: payload.chatId,
      });
    }
  }

  // 7. Get messages since last update (or all messages for first turn)
  const allEvents = await repos.chats.getMessages(payload.chatId);
  const allMessages = extractVisibleConversation(allEvents);

  // For subsequent turns, only get messages since last update
  // We use a simple approach: skip the first N messages where N = messages at last update
  const recentMessages = previousSceneState
    ? allMessages.slice(lastUpdateMessageCount > 0 ? Math.max(0, lastUpdateMessageCount - 2) : 0)
    : allMessages.slice(-20); // First turn: use last 20 messages

  if (recentMessages.length === 0) {
    logger.debug('[SceneStateTracking] No messages to process, skipping', { jobId: job.id, chatId: payload.chatId });
    return;
  }

  // 7b. Pre-classify content through the Concierge gatekeeper
  // The danger classification job runs in parallel and may not have completed yet,
  // so we classify the recent messages ourselves to decide provider routing.
  const { settings: dangerSettings } = resolveDangerousContentSettings(chatSettings);
  if (!isDangerousChat && uncensoredLLMSelection && dangerSettings.mode !== 'OFF') {
    try {
      const sampleText = recentMessages.slice(-10)
        .map(m => m.content.substring(0, 300))
        .join('\n');

      if (sampleText.length > 0) {
        const classification = await classifyContent(
          sampleText,
          cheapLLMSelection,
          job.userId,
          dangerSettings,
          payload.chatId
        );

        if (classification.isDangerous) {
          logger.info('[SceneStateTracking] Content pre-classified as dangerous, routing to uncensored provider', {
            jobId: job.id,
            chatId: payload.chatId,
            score: classification.score,
            categories: classification.categories.map(c => c.category),
            provider: uncensoredLLMSelection.provider,
          });
          cheapLLMSelection = uncensoredLLMSelection;
        }
      }
    } catch (error) {
      // Fail open — use standard provider if classification fails
      logger.warn('[SceneStateTracking] Content pre-classification failed, using standard provider', {
        jobId: job.id,
        chatId: payload.chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // 8. Build character baseline data
  const characterBaselines = validCharacters.map(char => ({
    characterId: char!.id,
    characterName: char!.name,
    physicalDescription: char!.physicalDescriptions?.[0]?.mediumPrompt || char!.physicalDescriptions?.[0]?.shortPrompt || '',
    clothingDescription: char!.clothingRecords?.[0]?.description || '',
    scenario: char!.scenario || undefined,
  }));

  // 8b. Extract chat scenario from participant system prompts
  // The systemPromptOverride on participants typically sets up the opening scene
  const chatScenarioParts: string[] = [];
  for (const participant of chat.participants) {
    if (participant.systemPromptOverride) {
      chatScenarioParts.push(participant.systemPromptOverride);
    }
  }
  // Also include context summary if available (provides ongoing scene context)
  if (chat.contextSummary) {
    chatScenarioParts.push(`Story so far: ${chat.contextSummary}`);
  }
  const chatScenario = chatScenarioParts.length > 0
    ? chatScenarioParts.join('\n\n')
    : undefined;

  // 9. Call updateSceneState
  const sceneStateInput = {
    previousSceneState,
    characters: characterBaselines,
    recentMessages,
    messageCount: chat.messageCount ?? 0,
    chatScenario,
  };

  // Build uncensored fallback options for the built-in retry in executeCheapLLMTask
  const uncensoredFallback = dangerSettings.mode !== 'OFF' ? {
    dangerSettings,
    availableProfiles,
  } : undefined;

  let result = await updateSceneState(
    sceneStateInput,
    cheapLLMSelection,
    job.userId,
    payload.chatId,
    uncensoredFallback
  );

  // 9b. If the result looks like a content refusal (location "Unknown" or empty),
  // retry with uncensored provider if available and we haven't already used it
  const looksLikeRefusal = result.success && result.result &&
    ((result.result as any).location === 'Unknown' || (result.result as any).location === 'unknown' || !(result.result as any).location);

  if (looksLikeRefusal && uncensoredLLMSelection && cheapLLMSelection !== uncensoredLLMSelection) {
    logger.info('[SceneStateTracking] Result looks like content refusal, retrying with uncensored provider', {
      jobId: job.id,
      chatId: payload.chatId,
      originalLocation: (result.result as any)?.location,
      provider: uncensoredLLMSelection.provider,
    });

    const retryResult = await updateSceneState(
      sceneStateInput,
      uncensoredLLMSelection,
      job.userId,
      payload.chatId
    );

    if (retryResult.success && retryResult.result &&
        (retryResult.result as any).location && (retryResult.result as any).location !== 'Unknown') {
      result = retryResult;
      cheapLLMSelection = uncensoredLLMSelection;
      logger.info('[SceneStateTracking] Retry with uncensored provider succeeded', {
        jobId: job.id, chatId: payload.chatId, location: (retryResult.result as any).location,
      });
    } else {
      logger.warn('[SceneStateTracking] Retry with uncensored provider also produced poor result', {
        jobId: job.id, chatId: payload.chatId,
        location: (retryResult.result as any)?.location,
        error: retryResult.error,
      });
    }
  }

  if (!result.success || !result.result) {
    logger.warn('[SceneStateTracking] Failed to derive scene state', {
      jobId: job.id, chatId: payload.chatId, error: result.error,
    });
    return;
  }

  // 10. Add timestamp metadata to the result
  const sceneState = {
    ...result.result,
    updatedAt: new Date().toISOString(),
    updatedAtMessageCount: chat.messageCount ?? 0,
  };

  // 11. Create system event for token tracking
  if (result.usage) {
    await createSystemEvent(payload.chatId, {
      systemEventType: 'SCENE_STATE_TRACKING',
      description: `Scene state updated: ${(sceneState as any).location || 'unknown location'}`,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      totalTokens: result.usage.totalTokens,
      provider: cheapLLMSelection.provider,
      modelName: cheapLLMSelection.modelName,
    });
  }

  // 12. Persist scene state to chat
  await repos.chats.update(payload.chatId, {
    sceneState: sceneState as Record<string, unknown>,
  });

  logger.info('[SceneStateTracking] Scene state updated', {
    jobId: job.id,
    chatId: payload.chatId,
    location: (sceneState as any).location,
    characterCount: (sceneState as any).characters?.length ?? 0,
    messageCount: chat.messageCount,
    isDangerousChat,
  });
}
