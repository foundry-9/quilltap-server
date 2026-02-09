/**
 * Inter-Character Memory Extraction Job Handler
 *
 * Handles INTER_CHARACTER_MEMORY background jobs by extracting memories
 * that one character has learned about another character from their conversation.
 */

import { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { extractInterCharacterMemoryFromMessage } from '@/lib/memory/cheap-llm-tasks';
import { getCheapLLMProvider, CheapLLMConfig } from '@/lib/llm/cheap-llm';
import { logger } from '@/lib/logger';
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
  const cheapLLMSelection = getCheapLLMProvider(
    connectionProfile,
    cheapLLMConfig,
    availableProfiles
  );
  // Extract inter-character memory
  const result = await extractInterCharacterMemoryFromMessage(
    payload.observerCharacterName,
    payload.observerMessage,
    payload.subjectCharacterName,
    payload.subjectMessage,
    cheapLLMSelection,
    job.userId
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
  if (!result.result || !result.result.significant) {
    return;
  }

  // Create the memory
  // Inter-character memories are stored on the observer character about the subject character
  const importance = result.result.importance || 0.5
  const memory = await repos.memories.create({
    characterId: payload.observerCharacterId,
    content: result.result.content || '',
    summary: result.result.summary || '',
    keywords: result.result.keywords || [],
    tags: [],
    importance,
    source: 'AUTO',
    chatId: payload.chatId,
    sourceMessageId: payload.sourceMessageId,
    // Store reference to the subject character this memory is about
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
