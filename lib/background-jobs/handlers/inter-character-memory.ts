/**
 * Inter-Character Memory Extraction Job Handler
 *
 * Handles INTER_CHARACTER_MEMORY background jobs by extracting memories
 * that one character has learned about another character from their conversation.
 */

import { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { extractInterCharacterMemoryFromMessage } from '@/lib/memory/cheap-llm-tasks';
import { getCheapLLMProvider, CheapLLMConfig, resolveUncensoredCheapLLMSelection } from '@/lib/llm/cheap-llm';
import { resolveMaxTokens } from '@/lib/llm/model-context-data';
import { logger } from '@/lib/logger';
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service';
import type { InterCharacterMemoryPayload } from '../queue-service';

/**
 * Handle an inter-character memory extraction job
 */
export async function handleInterCharacterMemory(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as InterCharacterMemoryPayload;
  const repos = getRepositories();

  // Get connection profile
  const connectionProfile = await repos.connections.findById(payload.connectionProfileId);
  if (!connectionProfile) {
    throw new Error(`Connection profile not found: ${payload.connectionProfileId}`);
  }

  // Get user's chat settings for cheap LLM config
  const chatSettings = await repos.chatSettings.findByUserId(job.userId);
  if (!chatSettings) {
    throw new Error(`Chat settings not found for user: ${job.userId}`);
  }

  // Get available profiles for cheap LLM selection
  const availableProfiles = await repos.connections.findByUserId(job.userId);

  // Convert settings to config (handle null -> undefined conversion)
  const cheapLLMConfig: CheapLLMConfig = {
    strategy: chatSettings.cheapLLMSettings.strategy,
    userDefinedProfileId: chatSettings.cheapLLMSettings.userDefinedProfileId || undefined,
    defaultCheapProfileId: chatSettings.cheapLLMSettings.defaultCheapProfileId || undefined,
    fallbackToLocal: chatSettings.cheapLLMSettings.fallbackToLocal,
  };

  // Get cheap LLM selection
  let cheapLLMSelection = getCheapLLMProvider(
    connectionProfile,
    cheapLLMConfig,
    availableProfiles
  );

  // Load chat to check danger status
  const chat = await repos.chats.findById(payload.chatId);

  // For dangerous chats, use uncensored provider to avoid content refusals
  const { settings: dangerSettings } = resolveDangerousContentSettings(chatSettings);
  if (chat?.isDangerousChat === true) {
    cheapLLMSelection = resolveUncensoredCheapLLMSelection(
      cheapLLMSelection,
      true,
      dangerSettings,
      availableProfiles
    );
  }

  // Build uncensored fallback options for empty-response retry
  const uncensoredFallback = dangerSettings.mode !== 'OFF' ? {
    dangerSettings,
    availableProfiles,
    isDangerousChat: chat?.isDangerousChat === true,
  } : undefined;

  // Resolve max tokens for the cheap LLM profile
  const resolvedMaxTokens = resolveMaxTokens(connectionProfile);

  // Extract inter-character memories
  const result = await extractInterCharacterMemoryFromMessage(
    payload.observerCharacterName,
    payload.observerMessage,
    payload.subjectCharacterName,
    payload.subjectMessage,
    cheapLLMSelection,
    job.userId,
    uncensoredFallback,
    payload.chatId,
    undefined, // observerPronouns
    undefined, // subjectPronouns
    resolvedMaxTokens
  );

  if (!result.success) {
    logger.warn('[InterCharacterMemory] Extraction failed', {
      jobId: job.id,
      chatId: payload.chatId,
      error: result.error,
    });
    return;
  }

  // If nothing significant was found, we're done
  const candidates = result.result || [];
  if (candidates.length === 0) {
    return;
  }

  // Create memories for each significant candidate
  // Inter-character memories are stored on the observer character about the subject character
  for (const candidate of candidates) {
    const importance = candidate.importance || 0.5;
    const memory = await repos.memories.create({
      characterId: payload.observerCharacterId,
      content: candidate.content || '',
      summary: candidate.summary || '',
      keywords: candidate.keywords || [],
      tags: [],
      importance,
      source: 'AUTO',
      chatId: payload.chatId,
      sourceMessageId: payload.sourceMessageId,
      aboutCharacterId: payload.subjectCharacterId,
      reinforcementCount: 1,
      relatedMemoryIds: [],
      reinforcedImportance: importance,
    });

    logger.info('[InterCharacterMemory] Memory created', {
      jobId: job.id,
      memoryId: memory.id,
      chatId: payload.chatId,
      observerCharacterId: payload.observerCharacterId,
      subjectCharacterId: payload.subjectCharacterId,
    });
  }
}
