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

/** Startup grace: wait this long after boot before the first tick.
 *  5 minutes, not 30 s, so the UI has time to finish compiling and the
 *  first page load completes before the sweep pins the main thread. */
const STARTUP_GRACE_MS = 5 * 60 * 1000;

/** Skip the initial startup tick if a successful scheduled sweep ran within
 *  this window. Prevents dev-restart thrashing from running a full sweep on
 *  every boot. */
const RECENT_RUN_WINDOW_MS = 20 * 60 * 60 * 1000;

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

  moduleLogger.info('Housekeeping scheduler started', { intervalMs, startupGraceMs: STARTUP_GRACE_MS });

  // Run once shortly after startup, unless a scheduled sweep already completed
  // recently (dev-restart friendly). The recurring setInterval above still
  // fires on its normal cadence either way.
  setTimeout(() => {
    runStartupHousekeepingTick().catch((error) => {
      moduleLogger.error('Error in initial housekeeping run', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, STARTUP_GRACE_MS);
}

/**
 * Startup tick wrapper that short-circuits when a scheduled run completed
 * within the recent-run window. Keeps development restarts from re-running
 * a full sweep every time the server comes up.
 */
async function runStartupHousekeepingTick(): Promise<void> {
  try {
    const repos = getRepositories();
    const cutoff = Date.now() - RECENT_RUN_WINDOW_MS;
    // Peek at the most recent MEMORY_HOUSEKEEPING jobs across the instance.
    // In single-user mode the userId is deterministic; we look across
    // all users in case the caller changes that. 50 rows is plenty — one
    // successful scheduled row in the window is enough to skip.
    const recent = await repos.backgroundJobs.findRecentByType(
      'MEMORY_HOUSEKEEPING',
      50,
    );
    const recentlyCompleted = recent.find((job) => {
      if (job.status !== 'COMPLETED') return false;
      if ((job.payload as Record<string, unknown>).reason !== 'scheduled') return false;
      const ts = new Date(job.updatedAt).getTime();
      return ts >= cutoff;
    });
    if (recentlyCompleted) {
      moduleLogger.info('Skipping startup housekeeping tick — recent scheduled run already completed', {
        jobId: recentlyCompleted.id,
        completedAt: recentlyCompleted.updatedAt,
      });
      return;
    }
  } catch (error) {
    moduleLogger.warn('Recent-run check failed; running startup housekeeping tick anyway', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  await runScheduledHousekeeping();
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
