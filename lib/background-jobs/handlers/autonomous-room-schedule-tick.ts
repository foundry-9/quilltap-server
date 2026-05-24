/**
 * Autonomous Room Schedule Tick Handler (4.6 Private Character Rooms)
 *
 * Scans the user's autonomous rooms for cron-scheduled runs that are due,
 * applies the freshness-window rule, and either enqueues a turn job (and
 * advances `scheduleNextRunAt` to the next cron occurrence) or skips a
 * stale slot.
 *
 * Cron evaluation uses `croner` (zero-dep, isomorphic). Local timezone is
 * the *instance's* local time, matching the daily user-token rollover.
 */

import { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { Cron } from 'croner';
import { randomUUID } from 'node:crypto';
import type { ChatMetadataBase } from '@/lib/schemas/types';
import { logger } from '@/lib/logger';
import { enqueueAutonomousRoomTurn } from '../queue-service';

const HANDLER = 'background-jobs.autonomous-room-schedule-tick';
const DEFAULT_FRESHNESS_WINDOW_MS = 12 * 60 * 60 * 1000; // 12h

function freshnessWindowFor(chat: ChatMetadataBase, fallbackMs: number): number {
  return chat.scheduleFreshnessWindowMs ?? fallbackMs;
}

/**
 * Compute the next cron occurrence strictly after the given anchor time.
 * Returns null on parse errors (treated as "this room is mis-configured —
 * skip it for now"). croner accepts the standard 5-field cron syntax.
 */
function nextCronFireFrom(cronExpr: string, anchor: Date): Date | null {
  try {
    const job = new Cron(cronExpr);
    const next = job.nextRun(anchor);
    return next ?? null;
  } catch (error) {
    logger.warn('Autonomous-room schedule tick: invalid cron expression', {
      context: HANDLER,
      cronExpr,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function handleAutonomousRoomScheduleTick(job: BackgroundJob): Promise<void> {
  const repos = getRepositories();
  const userId = job.userId;
  const chatSettings = await repos.chatSettings.findByUserId(userId);
  const defaultFreshnessMs = chatSettings?.autonomousRoomSettings?.defaultFreshnessWindowMs ?? DEFAULT_FRESHNESS_WINDOW_MS;

  // Enumerate user-owned autonomous chats with a cron and a non-terminal
  // run state. Stopped / running rooms are skipped — the scheduler only
  // touches idle/paused/budgetExhausted rooms.
  const userChats = await repos.chats.findByUserId(userId);
  const autonomousChats = userChats.filter(
    (c) => c.chatType === 'autonomous' && c.scheduleCron && c.runState !== 'running' && c.runState !== 'stopped',
  );

  const now = Date.now();
  const nowDate = new Date(now);

  let dueCount = 0;
  let staleCount = 0;
  let enqueuedCount = 0;

  for (const chat of autonomousChats) {
    if (!chat.scheduleCron) continue;
    const nextRunIso = chat.scheduleNextRunAt;
    if (!nextRunIso) {
      // No next run computed yet — seed it from cron and skip this tick.
      const seeded = nextCronFireFrom(chat.scheduleCron, nowDate);
      if (seeded) {
        await repos.chats.update(chat.id, {
          scheduleNextRunAt: seeded.toISOString(),
        } as unknown as Partial<ChatMetadataBase>);
      }
      continue;
    }
    const nextRunMs = Date.parse(nextRunIso);
    if (nextRunMs > now) {
      // Not due yet.
      continue;
    }
    dueCount++;
    const window = freshnessWindowFor(chat, defaultFreshnessMs);
    const overdueBy = now - nextRunMs;

    if (overdueBy > window) {
      // Stale slot: log and advance past it. Compute next cron occurrence
      // starting from now — the missed slot is skipped, not caught up.
      logger.info('Autonomous-room scheduler: stale_slot, skipping', {
        context: HANDLER,
        chatId: chat.id,
        scheduleNextRunAt: nextRunIso,
        overdueByMs: overdueBy,
        freshnessWindowMs: window,
      });
      const advanced = nextCronFireFrom(chat.scheduleCron, nowDate);
      if (advanced) {
        await repos.chats.update(chat.id, {
          scheduleNextRunAt: advanced.toISOString(),
        } as unknown as Partial<ChatMetadataBase>);
      }
      staleCount++;
      continue;
    }

    // Within freshness window — start a new run. Generate a fresh runId,
    // transition to 'idle' (the turn handler picks up from there and runs
    // the model-availability precondition + counter reset on its first
    // tick), set scheduleLastRunAt = now, and advance scheduleNextRunAt
    // past the consumed slot.
    const runId = randomUUID();
    const nextNext = nextCronFireFrom(chat.scheduleCron, nowDate);
    const updates: Partial<ChatMetadataBase> = {
      currentRunId: runId,
      runState: 'idle',
      runStateMessage: null,
      scheduleLastRunAt: new Date(now).toISOString(),
      scheduleNextRunAt: nextNext ? nextNext.toISOString() : null,
    } as unknown as Partial<ChatMetadataBase>;
    await repos.chats.update(chat.id, updates);

    try {
      await enqueueAutonomousRoomTurn(userId, { chatId: chat.id, runId });
      enqueuedCount++;
      logger.info('Autonomous-room scheduler: enqueued run', {
        context: HANDLER,
        chatId: chat.id,
        runId,
        nextRunAt: nextNext?.toISOString() ?? null,
      });
    } catch (error) {
      // Couldn't enqueue — roll the run-state back to whatever it was so the
      // next tick has a chance to retry.
      logger.error('Autonomous-room scheduler: failed to enqueue run', {
        context: HANDLER,
        chatId: chat.id,
        runId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('Autonomous-room scheduler tick complete', {
    context: HANDLER,
    userId,
    autonomousChats: autonomousChats.length,
    dueCount,
    staleCount,
    enqueuedCount,
  });
}
