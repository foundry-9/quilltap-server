/**
 * Scheduled Memory Housekeeping
 *
 * Daily sweep that enqueues a MEMORY_HOUSEKEEPING job for every user whose
 * autoHousekeepingSettings.enabled is true. The job handler decides whether
 * to actually do anything per character (based on cap + retention rules);
 * this driver only decides *who* gets a job enqueued.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { enqueueMemoryHousekeeping } from './queue-service';

const moduleLogger = logger.child({ module: 'scheduled-housekeeping' });

/** Scheduler state */
let housekeepingScheduler: ReturnType<typeof setInterval> | null = null;
let housekeepingSchedulerRunning = false;

/** Default interval: run daily (24 hours) */
const DEFAULT_HOUSEKEEPING_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Start the scheduled memory-housekeeping driver.
 * @param intervalMs - How often to run (default: 24 hours)
 */
export function scheduleHousekeeping(intervalMs: number = DEFAULT_HOUSEKEEPING_INTERVAL_MS): void {
  if (housekeepingSchedulerRunning) {
    return;
  }

  housekeepingSchedulerRunning = true;
  housekeepingScheduler = setInterval(() => {
    runScheduledHousekeeping().catch((error) => {
      moduleLogger.error('Error in scheduled housekeeping interval', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, intervalMs);

  moduleLogger.info('Housekeeping scheduler started', { intervalMs });

  // Run immediately on startup, but wait a grace period so we don't race the
  // app's own initialization. 30 s is fine — users don't need same-second sweep.
  setTimeout(() => {
    runScheduledHousekeeping().catch((error) => {
      moduleLogger.error('Error in initial housekeeping run', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, 30_000);
}

/** Stop the scheduled housekeeping driver. */
export function stopHousekeepingScheduler(): void {
  if (housekeepingScheduler) {
    clearInterval(housekeepingScheduler);
    housekeepingScheduler = null;
  }
  housekeepingSchedulerRunning = false;
  moduleLogger.info('Housekeeping scheduler stopped');
}

/** Return true if the scheduler is currently running. */
export function isHousekeepingSchedulerRunning(): boolean {
  return housekeepingSchedulerRunning;
}

/**
 * One scheduled pass: for each user with auto-housekeeping enabled, enqueue
 * a MEMORY_HOUSEKEEPING job that sweeps all of their characters. The enqueue
 * helper dedupes against in-flight jobs for the same (userId, characterId).
 */
export async function runScheduledHousekeeping(): Promise<{ usersProcessed: number; jobsEnqueued: number }> {
  moduleLogger.info('Starting scheduled memory housekeeping pass');

  try {
    const repos = getRepositories();
    const allChatSettings = await repos.chatSettings.findAll();

    let usersProcessed = 0;
    let jobsEnqueued = 0;

    for (const settings of allChatSettings) {
      if (!settings.autoHousekeepingSettings?.enabled) {
        continue;
      }

      try {
        await enqueueMemoryHousekeeping(settings.userId, {
          reason: 'scheduled',
        });
        jobsEnqueued++;
        usersProcessed++;
      } catch (error) {
        moduleLogger.warn('Failed to enqueue scheduled housekeeping for user', {
          userId: settings.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    moduleLogger.info('Scheduled housekeeping pass complete', {
      usersProcessed,
      jobsEnqueued,
      totalUsers: allChatSettings.length,
    });

    return { usersProcessed, jobsEnqueued };
  } catch (error) {
    moduleLogger.error('Scheduled housekeeping pass failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
