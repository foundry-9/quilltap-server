/**
 * Memory Extraction Job Handler
 *
 * Handles MEMORY_EXTRACTION background jobs by calling the existing
 * memory processing function from lib/memory/memory-processor.ts
 */

import { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { processMessageForMemory, MemoryExtractionContext } from '@/lib/memory/memory-processor';
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service';
import { createMemoryExtractionEvent } from '@/lib/services/system-events.service';
import { estimateMessageCost } from '@/lib/services/cost-estimation.service';
import type { Pronouns } from '@/lib/schemas/character.types';
import { logger } from '@/lib/logger';
import type { MemoryExtractionPayload } from '../queue-service';

/**
 * Handle a memory extraction job
 */
export async function handleMemoryExtraction(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as MemoryExtractionPayload;
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

  // Resolve dangerous-content context so the worker uses the same uncensored
  // fallback path the inline trigger used to.
  const { settings: dangerSettings } = resolveDangerousContentSettings(chatSettings);
  const chat = await repos.chats.findById(payload.chatId);

  // Build the memory extraction context. The optional pronouns and multi-character
  // fields ride along on the payload now that this runs in a worker rather than
  // inline in the chat handler.
  const ctx: MemoryExtractionContext = {
    characterId: payload.characterId,
    characterName: payload.characterName,
    characterPronouns: (payload.characterPronouns as Pronouns | null | undefined) ?? undefined,
    userCharacterName: payload.userCharacterName,
    userCharacterId: payload.userCharacterId,
    allCharacterNames: payload.allCharacterNames,
    allCharacterPronouns: payload.allCharacterPronouns as Record<string, Pronouns | null> | undefined,
    chatId: payload.chatId,
    userMessage: payload.userMessage,
    assistantMessage: payload.assistantMessage,
    sourceMessageId: payload.sourceMessageId,
    userId: job.userId,
    connectionProfile,
    cheapLLMSettings: chatSettings.cheapLLMSettings,
    availableProfiles,
    dangerSettings,
    isDangerousChat: chat?.isDangerousChat === true,
  };

  // Process the message for memory extraction
  const result = await processMessageForMemory(ctx);

  if (result.success) {
    if (result.memoryCreated) {
      logger.info('[MemoryExtraction] Memories created', {
        jobId: job.id,
        memoryIds: result.memoryIds,
        count: result.memoryIds.length,
        chatId: payload.chatId,
        characterId: payload.characterId,
        relatedMemoryIds: result.relatedMemoryIds,
      });
    } else if (result.memoryReinforced) {
      logger.info('[MemoryExtraction] Memories reinforced', {
        jobId: job.id,
        reinforcedMemoryIds: result.reinforcedMemoryIds,
        count: result.reinforcedMemoryIds.length,
        chatId: payload.chatId,
        characterId: payload.characterId,
      });
    } else {
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

  // Emit a token-tracking system event for the cheap-LLM extraction calls
  // (matches the behaviour the inline trigger used to provide).
  if (result.usage && (result.usage.promptTokens || result.usage.completionTokens)) {
    try {
      const costResult = await estimateMessageCost(
        connectionProfile.provider,
        connectionProfile.modelName,
        result.usage.promptTokens || 0,
        result.usage.completionTokens || 0,
        job.userId
      );
      await createMemoryExtractionEvent(
        payload.chatId,
        result.usage,
        connectionProfile.provider,
        connectionProfile.modelName,
        costResult.cost
      );
    } catch (e) {
      logger.warn('[MemoryExtraction] Failed to emit token tracking event', {
        jobId: job.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
