/**
 * Scheduled Autonomous Rooms (4.6 Private Character Rooms)
 *
 * Parent-process timer that enqueues one `AUTONOMOUS_ROOM_SCHEDULE_TICK` job
 * per minute. The actual scan-and-fire logic lives in the child-process
 * handler (`handlers/autonomous-room-schedule-tick.ts`) so DB reads + writes
 * follow the project's child-process write-buffering pattern.
 *
 * Mirrors the existing scheduled-cleanup / scheduled-housekeeping shape.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { enqueueAutonomousRoomScheduleTick } from './queue-service';

const moduleLogger = logger.child({ module: 'scheduled-autonomous-rooms' });

let autonomousScheduler: ReturnType<typeof setInterval> | null = null;
let autonomousSchedulerRunning = false;

/** Default tick interval: 60s. The scheduler granularity caps how reactive
 *  the scheduler is to a cron's edge; one minute matches typical cron usage
 *  and is cheap. */
const DEFAULT_TICK_INTERVAL_MS = 60_000;

export function scheduleAutonomousRooms(intervalMs: number = DEFAULT_TICK_INTERVAL_MS): void {
  if (autonomousSchedulerRunning) {
    return;
  }
  autonomousSchedulerRunning = true;
  autonomousScheduler = setInterval(() => {
    runAutonomousRoomsScheduleTick().catch((error) => {
      moduleLogger.error('Error in autonomous-rooms scheduler tick', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, intervalMs);
  moduleLogger.info('Autonomous-rooms scheduler started', { intervalMs });
  // Run immediately on startup so a freshly-booted server picks up any
  // overdue runs that fall inside their freshness window.
  runAutonomousRoomsScheduleTick().catch((error) => {
    moduleLogger.error('Error in initial autonomous-rooms scheduler tick', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

export function stopAutonomousRoomsScheduler(): void {
  if (autonomousScheduler) {
    clearInterval(autonomousScheduler);
    autonomousScheduler = null;
  }
  autonomousSchedulerRunning = false;
  moduleLogger.info('Autonomous-rooms scheduler stopped');
}

export function isAutonomousRoomsSchedulerRunning(): boolean {
  return autonomousSchedulerRunning;
}

/**
 * Enqueue one scheduler-tick job. Idempotent via the dedup check in
 * `enqueueAutonomousRoomScheduleTick`: a pending tick is reused rather than
 * stacked.
 */
async function runAutonomousRoomsScheduleTick(): Promise<void> {
  const repos = getRepositories();
  // Enumerate users with chat_settings — the scheduler tick is per-user so
  // it scans only that user's autonomous rooms. In a single-user instance
  // there is exactly one row.
  const allSettings = await repos.chatSettings.findAll();
  for (const settings of allSettings) {
    try {
      await enqueueAutonomousRoomScheduleTick(settings.userId);
    } catch (error) {
      moduleLogger.warn('Failed to enqueue autonomous-room schedule tick for user', {
        userId: settings.userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
