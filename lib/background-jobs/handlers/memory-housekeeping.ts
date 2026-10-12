/**
 * Memory Housekeeping Job Handler
 *
 * Runs the retention-policy housekeeping sweep for a single character or —
 * when no characterId is provided — every character owned by the user.
 * Settings come from `instance_settings.memoryMaintenance` through
 * `resolveMemorySettings` (whose `capFor` is the one cap resolver), and the
 * cap can be overridden per job via the payload.
 */

import type { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { runHousekeeping } from '@/lib/memory/housekeeping';
import { recordHousekeepingOutcome } from '@/lib/memory/housekeeping-outcome-cache';
import { logger } from '@/lib/logger';
import { resolveMemorySettings } from '@/lib/memory/settings';
import type { MemoryHousekeepingPayload } from '../queue-service';

export async function handleMemoryHousekeeping(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as MemoryHousekeepingPayload;
  const repos = getRepositories();

  const { maintenance } = await resolveMemorySettings(job.userId);

  if (!maintenance.enabled) {
    // Manual / one-shot jobs (e.g. from the "Run now" button) may still run
    // even when automatic maintenance is off. Only the automatic triggers
    // (watermark + scheduled) should bail here.
    if (payload.reason && payload.reason !== 'manual') {
      return;
    }
  }

  // Resolve target characters. Explicit characterId wins; otherwise sweep all
  // characters owned by the user.
  const targetCharacterIds: string[] = [];
  if (payload.characterId) {
    targetCharacterIds.push(payload.characterId);
  } else {
    try {
      const characters = await repos.characters.findByUserId(job.userId);
      targetCharacterIds.push(...characters.map(c => c.id));
    } catch (error) {
      logger.error('[Housekeeping] Failed to enumerate characters for user', {
        jobId: job.id,
        userId: job.userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
  }

  let totalDemoted = 0;
  let totalDeleted = 0;

  for (const characterId of targetCharacterIds) {
    // A payload cap wins; otherwise the character's override, then the global cap.
    const perCharacterCap = payload.maxMemories ?? maintenance.capFor(characterId);

    try {
      const result = await runHousekeeping(characterId, {
        maxMemories: perCharacterCap,
        ...(payload.dryRun !== undefined && { dryRun: payload.dryRun }),
      });

      // `deleteMemoriesWithUnlinkBatch` already counts from the resolved ids
      // when the child's buffered delete returns nothing; this is the last
      // line of defence so a NaN can never reach the log or the backoff below
      // (`NaN < minEffective` is false, which disarmed it).
      if (!Number.isFinite(result.deleted)) {
        logger.debug('[Housekeeping] Non-finite deleted count; using deleted id count', {
          jobId: job.id,
          characterId,
          reported: String(result.deleted),
          deletedIds: result.deletedIds.length,
        });
        result.deleted = result.deletedIds.length;
      }

      totalDemoted += result.demoted;
      totalDeleted += result.deleted;

      // Record outcome so watermark-triggered enqueues can back off when
      // the last sweep was practically ineffective (deleted 0 — or a
      // single-digit number against a corpus many thousands over cap).
      // Dry-runs don't count — they don't actually reduce the corpus.
      if (!payload.dryRun) {
        // The cap measures demotable rows only (bug 210), so effectiveness is
        // judged against the demotable count, not the whole hot tier.
        recordHousekeepingOutcome(
          characterId,
          result.demoted + result.deleted,
          result.demotable,
          result.capUsed,
        );
      }

      logger.info('[Housekeeping] Completed sweep for character', {
        jobId: job.id,
        userId: job.userId,
        characterId,
        reason: payload.reason ?? 'unknown',
        dryRun: payload.dryRun ?? false,
        totalBefore: result.totalBefore,
        totalAfter: result.totalAfter,
        demotable: result.demotable,
        protected: result.protected,
        cap: result.capUsed,
        demoted: result.demoted,
        deleted: result.deleted,
        cold: result.coldCount,
        kept: result.kept,
      });
    } catch (error) {
      logger.error('[Housekeeping] Sweep failed for character', {
        jobId: job.id,
        userId: job.userId,
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue with other characters instead of failing the whole job.
    }
  }

  logger.info('[Housekeeping] Job complete', {
    jobId: job.id,
    userId: job.userId,
    charactersSwept: targetCharacterIds.length,
    totalDemoted,
    totalDeleted,
    reason: payload.reason ?? 'unknown',
  });
}
