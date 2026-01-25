/**
 * Scheduled LLM Log Cleanup
 *
 * Provides functions to schedule and manage periodic LLM log cleanup tasks.
 * This module can be used to set up background cleanup jobs that run on a schedule.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { enqueueLLMLogCleanup } from './queue-service';

const moduleLogger = logger.child({ module: 'scheduled-cleanup' });

/** Cleanup scheduler state */
let cleanupScheduler: ReturnType<typeof setInterval> | null = null;
let cleanupSchedulerRunning = false;

/** Default interval: run daily (24 hours) */
const DEFAULT_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Schedule automatic LLM log cleanup to run periodically
 * @param intervalMs - How often to run cleanup (default: 24 hours)
 */
export function scheduleCleanup(intervalMs: number = DEFAULT_CLEANUP_INTERVAL_MS): void {
  if (cleanupSchedulerRunning) {
    return;
  }

  cleanupSchedulerRunning = true;
  cleanupScheduler = setInterval(() => {
    runScheduledCleanup().catch((error) => {
      moduleLogger.error('Error in scheduled cleanup interval', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, intervalMs);

  moduleLogger.info('Cleanup scheduler started', { intervalMs });

  // Run cleanup immediately on startup
  runScheduledCleanup().catch((error) => {
    moduleLogger.error('Error in initial cleanup', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

/**
 * Stop the cleanup scheduler
 */
export function stopCleanupScheduler(): void {
  if (cleanupScheduler) {
    clearInterval(cleanupScheduler);
    cleanupScheduler = null;
  }
  cleanupSchedulerRunning = false;
  moduleLogger.info('Cleanup scheduler stopped');
}

/**
 * Check if the cleanup scheduler is running
 */
export function isCleanupSchedulerRunning(): boolean {
  return cleanupSchedulerRunning;
}

/**
 * Run cleanup for all users with logging enabled
 * This is called automatically on the schedule, or can be called manually
 */
export async function runScheduledCleanup(): Promise<{ usersProcessed: number; jobsEnqueued: number }> {
  moduleLogger.info('Starting scheduled LLM log cleanup');

  try {
    const repos = getRepositories();

    // Get all users with chat settings
    const allChatSettings = await repos.chatSettings.findAll();

    let usersProcessed = 0;
    let jobsEnqueued = 0;

    // Enqueue cleanup jobs for each user with logging enabled
    for (const settings of allChatSettings) {
      if (settings.llmLoggingSettings?.enabled && settings.llmLoggingSettings.retentionDays > 0) {
        try {
          const jobId = await enqueueLLMLogCleanup(settings.userId, {
            userId: settings.userId,
            retentionDays: settings.llmLoggingSettings.retentionDays,
          });
          jobsEnqueued++;
          usersProcessed++;
        } catch (error) {
          moduleLogger.warn('Failed to enqueue cleanup job for user', {
            userId: settings.userId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    moduleLogger.info('Scheduled cleanup completed', {
      usersProcessed,
      jobsEnqueued,
      totalUsers: allChatSettings.length,
    });

    return { usersProcessed, jobsEnqueued };
  } catch (error) {
    moduleLogger.error('Scheduled cleanup failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Manually trigger cleanup for a specific user
 */
export async function triggerUserCleanup(userId: string, retentionDayOverride?: number): Promise<string> {
  moduleLogger.info('Triggering manual cleanup for user', { userId, retentionDayOverride });

  return enqueueLLMLogCleanup(userId, {
    userId,
    retentionDays: retentionDayOverride,
  });
}
