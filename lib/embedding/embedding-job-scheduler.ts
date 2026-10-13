/**
 * Embedding Job Scheduler
 *
 * Schedules debounced vocabulary refit jobs for BUILTIN embedding profiles
 * (when `builtin-refit-policy` says one is due) and cleans up embedding-status
 * rows when an embeddable entity is deleted.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { EmbeddableEntityType } from '@/lib/schemas/types';
import { processSingleton } from '@/lib/utils/process-singleton';
import { enqueueRefitIfDue } from './builtin-refit-policy';

/**
 * Debounce state for refit scheduling
 * Key: `${userId}:${profileId}`
 */
const refitDebounceTimers = processSingleton('embedding.refitDebounceTimers', () => new Map<string, NodeJS.Timeout>());

/** Debounce keys whose pending refit was requested with `force`. */
const forcedRefits = processSingleton('embedding.refitForced', () => new Set<string>());

/**
 * Default debounce delay for refit scheduling (5 seconds)
 */
const REFIT_DEBOUNCE_MS = 5000;

export interface ScheduleRefitOptions {
  /**
   * Refit whatever the vocabulary's state. For bulk corpus changes the drift
   * count cannot see — an import keeps its rows' original `createdAt`.
   */
  force?: boolean;
}

/**
 * Schedule a vocabulary refit for a BUILTIN profile (debounced)
 *
 * Multiple rapid calls will be collapsed into a single check; a forced call
 * keeps the collapsed check forced. Only schedules if the user has a BUILTIN
 * default profile. When the timer fires, the refit (with its full reindex) is
 * enqueued only if the vocabulary needs one (`assessBuiltinRefit`: unfitted,
 * fitted before the text-shape change, or drifted), or when forced — a
 * single memory edit is embedded against the current vocabulary and is not by
 * itself a reason to re-embed everything.
 *
 * @param userId The user ID
 * @param profileId Optional profile ID (uses default if not specified)
 */
export async function scheduleRefit(
  userId: string,
  profileId?: string,
  options: ScheduleRefitOptions = {}
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
  if (options.force) forcedRefits.add(debounceKey);

  // Clear any existing timer
  const existingTimer = refitDebounceTimers.get(debounceKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  logger.debug('[EmbeddingScheduler] Refit check scheduled (debounced)', {
    context: 'scheduleRefit',
    userId,
    profileId: profile.id,
    forced: forcedRefits.has(debounceKey),
  });

  // Schedule new refit with debounce
  const timer = setTimeout(async () => {
    refitDebounceTimers.delete(debounceKey);
    const forced = forcedRefits.delete(debounceKey);

    try {
      const decision = await enqueueRefitIfDue(profile, { force: forced, source: 'scheduleRefit' });
      if (!decision.reason) {
        logger.info('[EmbeddingScheduler] Refit not needed; the vocabulary is current', {
          context: 'scheduleRefit',
          userId,
          profileId: profile.id,
        });
      } else if (decision.enqueued) {
        logger.info('[EmbeddingScheduler] Refit job scheduled (debounced)', {
          context: 'scheduleRefit',
          userId,
          profileId: profile.id,
          reason: decision.reason,
        });
      }
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
