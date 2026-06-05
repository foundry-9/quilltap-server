/**
 * Embedding Job Scheduler
 *
 * Schedules debounced vocabulary refit jobs for BUILTIN embedding profiles
 * and cleans up embedding-status rows when an embeddable entity is deleted.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { enqueueEmbeddingRefit } from '@/lib/background-jobs/queue-service';
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
    return;
  }

  // Only refit for BUILTIN profiles
  if (profile.provider !== 'BUILTIN') {
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
  await repos.embeddingStatus.deleteByEntity(entityType, entityId);
}
