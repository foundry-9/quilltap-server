/**
 * Autonomous Room Service (4.6 Private Character Rooms)
 *
 * Manual-start entry point. The scheduled-run path lives in
 * `lib/background-jobs/handlers/autonomous-room-schedule-tick.ts`; both
 * funnel into the same run-start contract — generate a fresh runId, write
 * it atomically alongside `runState = 'idle'`, advance any consumed cron
 * slot, then enqueue the first `AUTONOMOUS_ROOM_TURN`. The turn handler
 * picks up from there.
 */

import { Cron } from 'croner';
import { randomUUID } from 'node:crypto';
import { getRepositories } from '@/lib/repositories/factory';
import { enqueueAutonomousRoomTurn } from '@/lib/background-jobs/queue-service';
import { logger } from '@/lib/logger';
import type { ChatMetadataBase } from '@/lib/schemas/types';

const HANDLER = 'autonomous-room.service';
const DEFAULT_FRESHNESS_WINDOW_MS = 12 * 60 * 60 * 1000;

export type StartManualRunResult =
  | { ok: true; runId: string; jobId: string }
  | { ok: false; reason: 'not_autonomous' | 'already_running' | 'chat_not_found'; message: string };

/**
 * Start an autonomous-room run manually, immediately. Rejects if the chat
 * isn't autonomous, or if there's already a non-terminal run in flight
 * (running). Idle/paused/budgetExhausted rooms are eligible — the new
 * runId atomically supersedes any prior state.
 */
export async function startAutonomousRoomManually(
  chatId: string,
  userId: string,
): Promise<StartManualRunResult> {
  const repos = getRepositories();

  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return { ok: false, reason: 'chat_not_found', message: 'Chat not found.' };
  }
  if (chat.chatType !== 'autonomous') {
    return { ok: false, reason: 'not_autonomous', message: 'This chat is not an autonomous room.' };
  }
  if (chat.runState === 'running') {
    return {
      ok: false,
      reason: 'already_running',
      message: 'An autonomous run is already in progress for this room.',
    };
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const runId = randomUUID();

  const chatSettings = await repos.chatSettings.findByUserId(userId);
  const defaultFreshnessMs = chatSettings?.autonomousRoomSettings?.defaultFreshnessWindowMs ?? DEFAULT_FRESHNESS_WINDOW_MS;
  const freshnessWindowMs = chat.scheduleFreshnessWindowMs ?? defaultFreshnessMs;

  // Consume the upcoming cron slot if it falls inside the freshness window:
  // a manual start that happens close to the scheduled slot replaces it,
  // and the next scheduled run advances forward past the consumed slot.
  let nextScheduledRunAt = chat.scheduleNextRunAt ?? null;
  if (chat.scheduleCron && chat.scheduleNextRunAt) {
    const nextMs = Date.parse(chat.scheduleNextRunAt);
    const distance = Math.abs(nextMs - now);
    if (distance <= freshnessWindowMs) {
      try {
        const advanced = new Cron(chat.scheduleCron).nextRun(new Date(now));
        nextScheduledRunAt = advanced ? advanced.toISOString() : nextScheduledRunAt;
      } catch (error) {
        logger.warn('Manual start: failed to advance scheduleNextRunAt past consumed slot', {
          context: HANDLER,
          chatId,
          cron: chat.scheduleCron,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  await repos.chats.update(chatId, {
    currentRunId: runId,
    runState: 'idle',
    runStateMessage: null,
    scheduleLastRunAt: nowIso,
    ...(nextScheduledRunAt !== chat.scheduleNextRunAt
      ? { scheduleNextRunAt: nextScheduledRunAt }
      : {}),
  } as unknown as Partial<ChatMetadataBase>);

  const jobId = await enqueueAutonomousRoomTurn(userId, { chatId, runId });

  logger.info('Manual autonomous-room run started', {
    context: HANDLER,
    chatId,
    runId,
    jobId,
    advancedNextRunAt: nextScheduledRunAt !== chat.scheduleNextRunAt,
  });

  return { ok: true, runId, jobId };
}

/**
 * Pause an active or eligible autonomous-room run. Idempotent; transitions
 * to 'paused' regardless of starting state when the chat is autonomous.
 */
export async function pauseAutonomousRoom(
  chatId: string,
): Promise<{ ok: boolean; message?: string }> {
  const repos = getRepositories();
  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return { ok: false, message: 'Chat not found.' };
  }
  if (chat.chatType !== 'autonomous') {
    return { ok: false, message: 'This chat is not an autonomous room.' };
  }
  await repos.chats.update(chatId, {
    runState: 'paused',
    runStateMessage: 'manual:paused',
  } as unknown as Partial<ChatMetadataBase>);
  logger.info('Autonomous-room: paused', { context: HANDLER, chatId });
  return { ok: true };
}

/**
 * Stop an autonomous-room run. Transitions to 'stopped' and bumps
 * currentRunId to a fresh UUID so any in-flight turn job exits cleanly via
 * the stale-run guard on its next tick.
 */
export async function stopAutonomousRoom(
  chatId: string,
): Promise<{ ok: boolean; message?: string }> {
  const repos = getRepositories();
  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return { ok: false, message: 'Chat not found.' };
  }
  if (chat.chatType !== 'autonomous') {
    return { ok: false, message: 'This chat is not an autonomous room.' };
  }
  await repos.chats.update(chatId, {
    runState: 'stopped',
    runStateMessage: 'manual:stopped',
    currentRunId: randomUUID(),
    runEndedAt: new Date().toISOString(),
  } as unknown as Partial<ChatMetadataBase>);
  logger.info('Autonomous-room: stopped', { context: HANDLER, chatId });
  return { ok: true };
}

/**
 * Resume a paused autonomous-room run by handing the lifecycle back to the
 * runner: clear the paused state to 'idle', generate a new runId, and
 * enqueue a fresh turn job. The handler's idle → running transition resets
 * the per-run counters (turns / tokens / startedAt).
 */
export async function resumeAutonomousRoom(
  chatId: string,
  userId: string,
): Promise<StartManualRunResult> {
  // Same shape as manual start — both build a fresh run on top of any
  // prior idle/paused/budgetExhausted state.
  return startAutonomousRoomManually(chatId, userId);
}

/**
 * Startup reconcile for autonomous-room runs interrupted by a server crash
 * or restart. Any chat with `chatType = 'autonomous'` and `runState =
 * 'running'` had its turn-worker killed mid-execution; without this sweep
 * the row stays `running` forever and `startAutonomousRoomManually` refuses
 * to re-engage. We transition it back to `idle`, bump `currentRunId` so any
 * zombie AUTONOMOUS_ROOM_TURN job that gets re-claimed by the dispatcher's
 * orphan reset exits cleanly via the stale-run guard, and record the
 * reconcile event on the row.
 *
 * Parent-process only. Idempotent — when nothing is stuck this is a single
 * findAll + filter with no writes.
 */
export async function reconcileAutonomousRunsAtStartup(): Promise<{ reconciledCount: number }> {
  const repos = getRepositories();

  const allChats = await repos.chats.findAll();
  const stuck = allChats.filter(
    (c) => c.chatType === 'autonomous' && c.runState === 'running',
  );

  if (stuck.length === 0) {
    return { reconciledCount: 0 };
  }

  const nowIso = new Date().toISOString();
  for (const chat of stuck) {
    await repos.chats.update(chat.id, {
      runState: 'idle',
      runStateMessage: 'restart:reconciled',
      currentRunId: randomUUID(),
      runEndedAt: nowIso,
    } as unknown as Partial<ChatMetadataBase>);
    logger.info('Autonomous-room: reconciled stuck run at startup', {
      context: HANDLER,
      chatId: chat.id,
      previousRunId: chat.currentRunId,
      runTurnsConsumed: chat.runTurnsConsumed,
      runTokensConsumed: chat.runTokensConsumed,
    });
  }

  logger.info('Autonomous-room startup reconcile complete', {
    context: HANDLER,
    reconciledCount: stuck.length,
  });
  return { reconciledCount: stuck.length };
}
