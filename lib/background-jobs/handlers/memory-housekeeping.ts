/**
 * Memory Housekeeping Job Handler
 *
 * Runs the retention-policy housekeeping sweep for a single character or —
 * when no characterId is provided — every character owned by the user.
 * Settings are pulled from the user's `autoHousekeepingSettings` and can be
 * overridden per-job via the payload (used by the "Run now" / preview API
 * paths so UI-configured dry-runs don't need a settings round-trip).
 */

import type { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { runHousekeeping } from '@/lib/memory/housekeeping';
import { recordHousekeepingOutcome } from '@/lib/memory/housekeeping-outcome-cache';
import { logger } from '@/lib/logger';
import type { MemoryHousekeepingPayload } from '../queue-service';

export async function handleMemoryHousekeeping(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as MemoryHousekeepingPayload;
  const repos = getRepositories();

  const chatSettings = await repos.chatSettings.findByUserId(job.userId);
  const autoSettings = chatSettings?.autoHousekeepingSettings;

  if (!autoSettings || !autoSettings.enabled) {
    // Manual / one-shot jobs (e.g. from the "Run now" button) may still run
    // even when auto-housekeeping is disabled at the user level. Only the
    // automatic triggers (watermark + scheduled) should bail here.
    if (payload.reason && payload.reason !== 'manual') {
      logger.debug('[Housekeeping] Auto-housekeeping disabled for user — skipping automatic run', {
        jobId: job.id,
        userId: job.userId,
        reason: payload.reason,
      });
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

  // Resolve per-call options. Payload overrides win over user settings, which
  // win over housekeeping.ts defaults.
  const mergeThreshold =
    payload.mergeThreshold ?? autoSettings?.autoMergeSimilarThreshold;
  const mergeSimilar = payload.mergeSimilar ?? autoSettings?.mergeSimilar;

  let totalDeleted = 0;
  let totalMerged = 0;

  for (const characterId of targetCharacterIds) {
    const perCharacterCap =
      payload.maxMemories ??
      autoSettings?.perCharacterCapOverrides?.[characterId] ??
      autoSettings?.perCharacterCap;

    try {
      const result = await runHousekeeping(characterId, {
        userId: job.userId,
        ...(perCharacterCap !== undefined && { maxMemories: perCharacterCap }),
        ...(mergeThreshold !== undefined && { mergeThreshold }),
        ...(mergeSimilar !== undefined && { mergeSimilar }),
        ...(payload.dryRun !== undefined && { dryRun: payload.dryRun }),
      });

      totalDeleted += result.deleted;
      totalMerged += result.merged;

      // Record outcome so watermark-triggered enqueues can back off when
      // the last sweep was practically ineffective (deleted 0 — or a
      // single-digit number against a corpus many thousands over cap).
      // Dry-runs don't count — they don't actually reduce the corpus.
      if (!payload.dryRun) {
        recordHousekeepingOutcome(
          characterId,
          result.deleted,
          result.totalBefore,
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
        deleted: result.deleted,
        merged: result.merged,
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
    totalDeleted,
    totalMerged,
    reason: payload.reason ?? 'unknown',
  });
}
