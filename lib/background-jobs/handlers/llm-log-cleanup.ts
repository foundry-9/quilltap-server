/**
 * LLM Log Cleanup Job Handler
 *
 * Handles LLM_LOG_CLEANUP background jobs by deleting old LLM logs
 * based on the user's retention settings.
 */

import { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';

/**
 * Payload for LLM log cleanup job
 */
export interface LLMLogCleanupPayload {
  userId: string;
  /** Optional: override the retention days from settings (for manual cleanup) */
  retentionDays?: number;
}

/**
 * Handle an LLM log cleanup job
 */
export async function handleLLMLogCleanup(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as LLMLogCleanupPayload;
  const repos = getRepositories();

  try {
    let retentionDays = payload.retentionDays;

    // If not provided in payload, get from user's chat settings
    if (retentionDays === undefined) {
      const chatSettings = await repos.chatSettings.findByUserId(job.userId);
      if (!chatSettings) {
        logger.warn('[LLMLogCleanup] Chat settings not found, skipping', {
          jobId: job.id,
          userId: job.userId,
        });
        return;
      }

      retentionDays = chatSettings.llmLoggingSettings?.retentionDays ?? 30;
    }

    // Skip if retention is 0 (keep forever) or if cleanup is disabled
    if (retentionDays <= 0) {
      return;
    }

    // Get chat settings to check if logging is enabled
    const chatSettings = await repos.chatSettings.findByUserId(job.userId);
    if (chatSettings && !chatSettings.llmLoggingSettings?.enabled) {
      return;
    }

    // Delete old logs
    const deletedCount = await repos.llmLogs.cleanupOldLogs(job.userId, retentionDays);

    logger.info('[LLMLogCleanup] Cleanup completed', {
      jobId: job.id,
      userId: job.userId,
      deletedCount,
      retentionDays,
    });
  } catch (error) {
    logger.error('[LLMLogCleanup] Cleanup failed', {
      jobId: job.id,
      userId: job.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
