/**
 * Memory Extraction Job Handler
 *
 * Handles MEMORY_EXTRACTION background jobs by calling the existing
 * memory processing function from lib/memory/memory-processor.ts
 */

import { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { processMessageForMemory, MemoryExtractionContext } from '@/lib/memory/memory-processor';
import { logger } from '@/lib/logger';
import type { MemoryExtractionPayload } from '../queue-service';

/**
 * Handle a memory extraction job
 */
export async function handleMemoryExtraction(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as MemoryExtractionPayload;

  logger.debug('[MemoryExtraction] Starting job', {
    jobId: job.id,
    chatId: payload.chatId,
    characterId: payload.characterId,
  });

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

  // Get available profiles for user-defined strategy
  const availableProfiles = await repos.connections.findByUserId(job.userId);

  // Build the memory extraction context
  const ctx: MemoryExtractionContext = {
    characterId: payload.characterId,
    characterName: payload.characterName,
    chatId: payload.chatId,
    userMessage: payload.userMessage,
    assistantMessage: payload.assistantMessage,
    sourceMessageId: payload.sourceMessageId,
    userId: job.userId,
    connectionProfile,
    cheapLLMSettings: chatSettings.cheapLLMSettings,
    availableProfiles,
  };

  // Process the message for memory extraction
  const result = await processMessageForMemory(ctx);

  if (result.success) {
    if (result.memoryCreated) {
      logger.info('[MemoryExtraction] Memory created', {
        jobId: job.id,
        memoryId: result.memoryId,
        chatId: payload.chatId,
        characterId: payload.characterId,
      });
    } else {
      logger.debug('[MemoryExtraction] No significant memory found', {
        jobId: job.id,
        chatId: payload.chatId,
        characterId: payload.characterId,
      });
    }
  } else {
    // Log the error but don't throw - let the job complete
    // The memory extraction logic already handles this gracefully
    logger.warn('[MemoryExtraction] Extraction did not succeed', {
      jobId: job.id,
      chatId: payload.chatId,
      characterId: payload.characterId,
      error: result.error,
    });
  }

  // Store debug logs on the message if available
  if (result.debugLogs && result.debugLogs.length > 0 && payload.sourceMessageId) {
    try {
      await repos.chats.updateMessage(
        payload.chatId,
        payload.sourceMessageId,
        { debugMemoryLogs: result.debugLogs }
      );
    } catch (e) {
      logger.warn('[MemoryExtraction] Failed to store debug logs', {
        jobId: job.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
