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
    // Fresh run — drop any pause state left over from a prior run so it can't
    // bleed into this run's wall-clock accounting.
    runPausedAt: null,
    runPausedAccumMs: 0,
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
    // Stamp when the pause took effect so a later resume can fold this
    // interval into runPausedAccumMs and keep it out of the wall-clock budget.
    runPausedAt: new Date().toISOString(),
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
 * Resume an autonomous-room run.
 *
 * When the room is genuinely *paused* (and still owns a live run), this
 * continues the SAME run rather than starting a new one: the run's counters
 * (turns / tokens), runId, and runStartedAt are preserved, and no "run begun"
 * announcement is posted. The paused interval is folded into runPausedAccumMs
 * (which the wall-clock budget subtracts) rather than shifting runStartedAt —
 * runStartedAt also anchors the token-accounting window, so moving it would
 * drop pre-pause tokens from the count. The row is flipped straight back to
 * `running`, so the turn handler skips both its not-active early-exit and its
 * idle→running start block (which is what posts the banner and zeroes the
 * counters) and goes directly to the next turn.
 *
 * For any other state (idle / stopped / budgetExhausted / error, or a paused
 * row with no runId), there's nothing meaningful to continue, so we fall back
 * to a fresh run via `startAutonomousRoomManually` — a brand-new runId with
 * reset counters and the usual start announcement.
 */
export async function resumeAutonomousRoom(
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

  // Anything that isn't a live paused run starts fresh.
  if (chat.runState !== 'paused' || !chat.currentRunId) {
    return startAutonomousRoomManually(chatId, userId);
  }

  const now = Date.now();
  const runId = chat.currentRunId;

  // Exclude the paused interval from the wall-clock budget by accumulating it
  // into runPausedAccumMs — NOT by shifting runStartedAt. runStartedAt is also
  // the token-accounting window start (the turn handler sums llm_logs since
  // that instant), so moving it forward would drop every pre-pause token from
  // the count. The wall-clock check subtracts runPausedAccumMs instead.
  let runPausedAccumMs = chat.runPausedAccumMs ?? 0;
  if (chat.runPausedAt) {
    const pausedForMs = now - Date.parse(chat.runPausedAt);
    if (Number.isFinite(pausedForMs) && pausedForMs > 0) {
      runPausedAccumMs += pausedForMs;
    }
  }

  await repos.chats.update(chatId, {
    runState: 'running',
    runStateMessage: null,
    runEndedAt: null,
    runPausedAt: null,
    runPausedAccumMs,
    // currentRunId / runStartedAt / runTurnsConsumed / runTokensConsumed are
    // deliberately left untouched — this continues the existing run.
  } as unknown as Partial<ChatMetadataBase>);

  const jobId = await enqueueAutonomousRoomTurn(userId, { chatId, runId });

  logger.info('Autonomous-room: resumed (continuing run)', {
    context: HANDLER,
    chatId,
    runId,
    jobId,
    runPausedAccumMs,
  });

  return { ok: true, runId, jobId };
}

/**
 * Startup reconcile for autonomous-room runs interrupted by a server crash
 * or restart. Any chat with `chatType = 'autonomous'` and `runState =
 * 'running'` had its turn-worker killed mid-execution; without this sweep
 * the row stays `running` forever and `startAutonomousRoomManually` refuses
 * to re-engage.
 *
 * We transition it to `paused` (not `idle`) so the interrupted run is
 * *resumable*: `resumeAutonomousRoom` will continue it in place, preserving
 * the turn/token counters and transcript rather than starting over. We bump
 * `currentRunId` so any zombie AUTONOMOUS_ROOM_TURN job re-claimed by the
 * dispatcher's orphan reset exits cleanly via the stale-run guard, and stamp
 * `runPausedAt` from the last message (the best proxy for when the run
 * actually stopped conversing) so a later resume excludes the outage from the
 * wall-clock budget. Counters and `runEndedAt` are deliberately left as the
 * resumable state expects (counters preserved; not ended).
 *
 * Scheduled (cron) rooms are unaffected operationally: the scheduler tick
 * treats `paused` as eligible, so the next cron slot still starts a fresh run
 * if the household never resumes manually.
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
      runState: 'paused',
      runStateMessage: 'restart:interrupted',
      currentRunId: randomUUID(),
      runEndedAt: null,
      runPausedAt: chat.lastMessageAt ?? chat.runStartedAt ?? nowIso,
    } as unknown as Partial<ChatMetadataBase>);
    logger.info('Autonomous-room: reconciled stuck run at startup (paused, resumable)', {
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
