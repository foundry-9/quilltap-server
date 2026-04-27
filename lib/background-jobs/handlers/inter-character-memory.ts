/**
 * Inter-Character Memory Extraction Job Handler
 *
 * Handles INTER_CHARACTER_MEMORY background jobs. Delegates the actual work
 * to processInterCharacterMemory in lib/memory/memory-processor so the
 * inter-character path shares the Memory Gate's dedup, SKIP tiers, and rate
 * limiting with the single-character path — previously this handler wrote
 * memories directly, bypassing every gate improvement.
 */

import type { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import {
  processInterCharacterMemory,
  type InterCharacterMemoryContext,
} from '@/lib/memory/memory-processor';
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service';
import type { Pronouns } from '@/lib/schemas/character.types';
import { logger } from '@/lib/logger';
import type { InterCharacterMemoryPayload } from '../queue-service';

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

  // Get available profiles for user-defined strategy / uncensored fallback
  const availableProfiles = await repos.connections.findByUserId(job.userId);

  // Resolve dangerous-content settings so the processor's internal uncensored
  // routing sees the same context the old inline handler used to.
  const { settings: dangerSettings } = resolveDangerousContentSettings(chatSettings);
  const chat = await repos.chats.findById(payload.chatId);

  const ctx: InterCharacterMemoryContext = {
    observerCharacterId: payload.observerCharacterId,
    observerCharacterName: payload.observerCharacterName,
    observerCharacterPronouns: (payload.observerCharacterPronouns as Pronouns | null | undefined) ?? undefined,
    observerMessage: payload.observerMessage,
    subjectCharacterId: payload.subjectCharacterId,
    subjectCharacterName: payload.subjectCharacterName,
    subjectCharacterPronouns: (payload.subjectCharacterPronouns as Pronouns | null | undefined) ?? undefined,
    subjectMessage: payload.subjectMessage,
    chatId: payload.chatId,
    sourceMessageId: payload.sourceMessageId,
    userId: job.userId,
    connectionProfile,
    cheapLLMSettings: chatSettings.cheapLLMSettings,
    availableProfiles,
    dangerSettings,
    isDangerousChat: chat?.isDangerousChat === true,
    memoryExtractionLimits: chatSettings.memoryExtractionLimits,
  };

  const result = await processInterCharacterMemory(ctx);

  if (!result.success) {
    logger.warn('[InterCharacterMemory] Processing did not succeed', {
      jobId: job.id,
      chatId: payload.chatId,
      observerCharacterId: payload.observerCharacterId,
      subjectCharacterId: payload.subjectCharacterId,
      error: result.error,
    });
    return;
  }

  if (result.memoryCreated) {
    logger.info('[InterCharacterMemory] Memories created', {
      jobId: job.id,
      memoryIds: result.memoryIds,
      count: result.memoryIds.length,
      chatId: payload.chatId,
      observerCharacterId: payload.observerCharacterId,
      subjectCharacterId: payload.subjectCharacterId,
      relatedMemoryIds: result.relatedMemoryIds,
    });
  } else if (result.memoryReinforced) {
    logger.info('[InterCharacterMemory] Memories reinforced', {
      jobId: job.id,
      reinforcedMemoryIds: result.reinforcedMemoryIds,
      count: result.reinforcedMemoryIds.length,
      chatId: payload.chatId,
      observerCharacterId: payload.observerCharacterId,
      subjectCharacterId: payload.subjectCharacterId,
    });
  }

  // Note: debug logs from the processor are not persisted here. The
  // single-character handler overwrites message.debugMemoryLogs on each run,
  // which would race with this handler when multiple observers extract from
  // the same source message. Preserving the pre-refactor behaviour of not
  // persisting inter-character debug logs at all is intentional until a
  // proper append/merge path exists.
}
