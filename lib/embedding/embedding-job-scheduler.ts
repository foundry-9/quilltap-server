/**
 * Embedding Job Scheduler
 *
 * Provides functions to schedule embedding jobs with debouncing.
 * Used when memories are created, updated, or deleted to:
 * 1. Schedule embedding for the affected memory
 * 2. Schedule vocabulary refit for BUILTIN profiles (debounced)
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import {
  enqueueEmbeddingGenerate,
  enqueueEmbeddingRefit,
} from '@/lib/background-jobs/queue-service';
import type { EmbeddableEntityType } from '@/lib/schemas/types';

/**
 * Debounce state for refit scheduling
 * Key: `${userId}:${profileId}`
 */
const refitDebounceTimers = new Map<string, NodeJS.Timeout>();

/**
 * Default debounce delay for refit scheduling (5 seconds)
 */
const REFIT_DEBOUNCE_MS = 5000;

/**
 * Schedule an embedding for a single entity
 *
 * Creates an embedding status record (if not exists) and enqueues
 * an EMBEDDING_GENERATE job.
 *
 * @param userId The user ID
 * @param entityType The type of entity (MEMORY)
 * @param entityId The entity ID
 * @param characterId Optional character ID (for memories)
 */
export async function scheduleEmbedding(
  userId: string,
  entityType: EmbeddableEntityType,
  entityId: string,
  characterId?: string
): Promise<void> {
  const repos = getRepositories();

  // Get the user's default embedding profile
  const profile = await repos.embeddingProfiles.findDefault(userId);

  if (!profile) {
    logger.debug('[EmbeddingScheduler] No default embedding profile, skipping', {
      context: 'scheduleEmbedding',
      userId,
      entityType,
      entityId,
    });
    return;
  }

  // Create or update the embedding status record
  await repos.embeddingStatus.upsertByEntity(entityType, entityId, profile.id, {
    userId,
    status: 'PENDING',
    embeddedAt: null,
    error: null,
  });

  // Currently only MEMORY is supported for embedding
  if (entityType !== 'MEMORY') {
    logger.debug('[EmbeddingScheduler] Entity type not supported for embedding', {
      context: 'scheduleEmbedding',
      entityType,
    });
    return;
  }

  // Enqueue the generate job
  await enqueueEmbeddingGenerate(userId, {
    entityType: 'MEMORY',
    entityId,
    characterId,
    profileId: profile.id,
  });

  logger.debug('[EmbeddingScheduler] Embedding job scheduled', {
    context: 'scheduleEmbedding',
    userId,
    entityType,
    entityId,
    profileId: profile.id,
  });
}

/**
 * Schedule a vocabulary refit for a BUILTIN profile (debounced)
 *
 * Multiple rapid calls will be collapsed into a single refit.
 * Only schedules if the user has a BUILTIN default profile.
 *
 * @param userId The user ID
 * @param profileId Optional profile ID (uses default if not specified)
 */
export async function scheduleRefit(
  userId: string,
  profileId?: string
): Promise<void> {
  const repos = getRepositories();

  // Get the profile
  let profile;
  if (profileId) {
    profile = await repos.embeddingProfiles.findById(profileId);
  } else {
    profile = await repos.embeddingProfiles.findDefault(userId);
  }

  if (!profile) {
    logger.debug('[EmbeddingScheduler] No embedding profile, skipping refit', {
      context: 'scheduleRefit',
      userId,
      profileId,
    });
    return;
  }

  // Only refit for BUILTIN profiles
  if (profile.provider !== 'BUILTIN') {
    logger.debug('[EmbeddingScheduler] Non-BUILTIN profile, skipping refit', {
      context: 'scheduleRefit',
      userId,
      profileId: profile.id,
      provider: profile.provider,
    });
    return;
  }

  const debounceKey = `${userId}:${profile.id}`;

  // Clear any existing timer
  const existingTimer = refitDebounceTimers.get(debounceKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // Schedule new refit with debounce
  const timer = setTimeout(async () => {
    refitDebounceTimers.delete(debounceKey);

    try {
      await enqueueEmbeddingRefit(userId, {
        profileId: profile.id,
        triggerReindex: true,
      });

      logger.info('[EmbeddingScheduler] Refit job scheduled (debounced)', {
        context: 'scheduleRefit',
        userId,
        profileId: profile.id,
      });
    } catch (error) {
      logger.error('[EmbeddingScheduler] Failed to schedule refit job', {
        context: 'scheduleRefit',
        userId,
        profileId: profile.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, REFIT_DEBOUNCE_MS);

  refitDebounceTimers.set(debounceKey, timer);

  logger.debug('[EmbeddingScheduler] Refit scheduled (debounce started)', {
    context: 'scheduleRefit',
    userId,
    profileId: profile.id,
    debounceMs: REFIT_DEBOUNCE_MS,
  });
}

/**
 * Cancel any pending refit for a user/profile
 *
 * @param userId The user ID
 * @param profileId The profile ID
 */
export function cancelPendingRefit(userId: string, profileId: string): void {
  const debounceKey = `${userId}:${profileId}`;
  const timer = refitDebounceTimers.get(debounceKey);

  if (timer) {
    clearTimeout(timer);
    refitDebounceTimers.delete(debounceKey);

    logger.debug('[EmbeddingScheduler] Pending refit cancelled', {
      context: 'cancelPendingRefit',
      userId,
      profileId,
    });
  }
}

/**
 * Schedule embedding and refit for a new memory
 *
 * Convenience function that schedules both the embedding and the refit.
 *
 * @param userId The user ID
 * @param memoryId The memory ID
 * @param characterId The character ID
 */
export async function scheduleMemoryEmbedding(
  userId: string,
  memoryId: string,
  characterId: string
): Promise<void> {
  // Schedule the embedding
  await scheduleEmbedding(userId, 'MEMORY', memoryId, characterId);

  // Schedule refit for BUILTIN profiles (debounced)
  await scheduleRefit(userId);
}

/**
 * Handle memory deletion - clean up embedding status
 *
 * @param entityType The entity type
 * @param entityId The entity ID
 */
export async function handleEntityDeletion(
  entityType: EmbeddableEntityType,
  entityId: string
): Promise<void> {
  const repos = getRepositories();

  // Delete embedding status records for this entity
  const deletedCount = await repos.embeddingStatus.deleteByEntity(entityType, entityId);

  if (deletedCount > 0) {
    logger.debug('[EmbeddingScheduler] Embedding status deleted', {
      context: 'handleEntityDeletion',
      entityType,
      entityId,
      deletedCount,
    });
  }
}
