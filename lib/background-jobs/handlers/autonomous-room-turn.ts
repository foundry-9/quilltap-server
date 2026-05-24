/**
 * Autonomous Room Turn Handler (4.6 Private Character Rooms)
 *
 * Drives one turn of a `chatType: 'autonomous'` chat. The substrate is the
 * ordinary Salon path — speaker selection via `selectNextSpeaker`, message
 * processing via `handleSendMessage` with `continueMode: true,
 * respondingParticipantId`. This handler adds:
 *   - a stale-run guard (`payload.runId !== chat.currentRunId` → exit clean)
 *   - run-state lifecycle (idle → running → ...)
 *   - per-turn budget bookkeeping (turns, tokens, wall-clock)
 *   - the `neverPauseForUser` + `suppressAutomaticImages` flags
 *   - self-re-enqueue for the next turn if the run is still alive
 *
 * Budget enforcement (daily user-token cap, spend cap) and tool filtering
 * land in Sub-task C; this handler's pre-turn budget check covers the three
 * caps that read off the chat row directly (turns, room tokens, wall-clock).
 *
 * Memory extraction kicks off through the ordinary `handleSendMessage` path
 * — no special wiring is needed here; the extractor consults `chat.chatType`
 * in Sub-task D to attribute memories correctly.
 */

import { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { handleSendMessage } from '@/lib/services/chat-message/orchestrator.service';
import {
  selectNextSpeaker,
  calculateTurnStateFromHistory,
  getActiveCharacterParticipants,
} from '@/lib/chat/turn-manager';
import type {
  AutonomousRunState,
  Character,
  ChatMetadataBase,
  MessageEvent,
} from '@/lib/schemas/types';
import { logger } from '@/lib/logger';
import type { AutonomousRoomTurnPayload } from '../queue-service';
import { enqueueAutonomousRoomTurn } from '../queue-service';

const HANDLER = 'background-jobs.autonomous-room-turn';

interface BudgetVerdict {
  exhausted: false;
}

interface BudgetExhausted {
  exhausted: true;
  nextState: 'budgetExhausted' | 'paused';
  reason: string;
}

type BudgetCheckResult = BudgetVerdict | BudgetExhausted;

/**
 * Compute the ISO timestamp of the most recent instance-local midnight.
 * The autonomous-room daily user-token cap rolls over at the *instance's*
 * local-time midnight (per the resolved-decisions section of the spec).
 */
function lastLocalMidnightIso(now: number): string {
  const d = new Date(now);
  // Construct a Date at 00:00:00 in the instance's local timezone.
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  return midnight.toISOString();
}

/**
 * Pre-turn budget verdict. Reads the per-row chat caps directly; for the
 * daily user-token cap, the caller passes in the summed usage since
 * instance-local midnight (read off llm_logs).
 */
function checkBudget(
  chat: ChatMetadataBase,
  now: number,
  options: {
    dailyTokenBudget: number | null;
    dailyTokensSpent: number;
  },
): BudgetCheckResult {
  if (chat.budgetMaxWallClockMs != null && chat.runStartedAt) {
    const elapsed = now - Date.parse(chat.runStartedAt);
    if (elapsed >= chat.budgetMaxWallClockMs) {
      return { exhausted: true, nextState: 'budgetExhausted', reason: 'wall_clock' };
    }
  }
  if (chat.budgetMaxTurns != null && (chat.runTurnsConsumed ?? 0) >= chat.budgetMaxTurns) {
    return { exhausted: true, nextState: 'budgetExhausted', reason: 'turns' };
  }
  if (chat.budgetMaxTokens != null && (chat.runTokensConsumed ?? 0) >= chat.budgetMaxTokens) {
    return { exhausted: true, nextState: 'budgetExhausted', reason: 'tokens_room' };
  }
  // Daily user-token cap: transitions to 'paused' (not 'budgetExhausted')
  // because the room resumes tomorrow when the scheduler re-evaluates.
  if (options.dailyTokenBudget != null && options.dailyTokensSpent >= options.dailyTokenBudget) {
    return { exhausted: true, nextState: 'paused', reason: 'tokens_user_daily' };
  }
  return { exhausted: false };
}

/**
 * Drain `handleSendMessage`'s stream. Autonomous-room turns don't have a
 * client listening; the bytes are persisted via the orchestrator's internal
 * `processMessage` writes, and the stream is just SSE for the UI.
 */
async function drainStream(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader();
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done } = await reader.read();
      if (done) return;
    }
  } finally {
    reader.releaseLock();
  }
}

async function transitionRunState(
  chatId: string,
  to: AutonomousRunState,
  extra: Partial<{
    runStateMessage: string | null;
    runEndedAt: string | null;
    runStartedAt: string | null;
    runTurnsConsumed: number;
    runTokensConsumed: number;
  }> = {},
): Promise<void> {
  const repos = getRepositories();
  await repos.chats.update(chatId, {
    runState: to,
    ...extra,
  } as unknown as Partial<ChatMetadataBase>);
}

export async function handleAutonomousRoomTurn(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as AutonomousRoomTurnPayload;
  const { chatId, runId } = payload;
  const userId = job.userId;
  const repos = getRepositories();

  // 1. Resolve chat
  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    logger.warn('Autonomous-room turn: chat not found, exiting', {
      context: HANDLER, chatId, runId,
    });
    return;
  }
  if (chat.chatType !== 'autonomous') {
    logger.info('Autonomous-room turn: chat is not autonomous, exiting', {
      context: HANDLER, chatId, chatType: chat.chatType,
    });
    return;
  }

  // 2. Stale-run guard
  if (chat.currentRunId !== runId) {
    logger.info('Autonomous-room turn: stale_run_job (superseded by a newer run)', {
      context: HANDLER, chatId, payloadRunId: runId, currentRunId: chat.currentRunId,
    });
    return;
  }

  // 3. Lifecycle entry
  if (chat.runState === 'paused' || chat.runState === 'stopped'
   || chat.runState === 'budgetExhausted' || chat.runState === 'error') {
    logger.info('Autonomous-room turn: run not active, exiting', {
      context: HANDLER, chatId, runState: chat.runState,
    });
    return;
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  if (chat.runState == null || chat.runState === 'idle') {
    // Run start. Model-availability precondition lands in Sub-task C; for the
    // Sub-task B verification path we trust the connection profile already
    // resolves for each participant (the manual-start helper will gate this
    // up-front once Sub-task C lands).
    await transitionRunState(chatId, 'running', {
      runStartedAt: nowIso,
      runEndedAt: null,
      runStateMessage: null,
      runTurnsConsumed: 0,
      runTokensConsumed: 0,
    });
    chat.runState = 'running';
    chat.runStartedAt = nowIso;
    chat.runTurnsConsumed = 0;
    chat.runTokensConsumed = 0;
  }

  // 4. Pre-turn budget check
  const chatSettings = await repos.chatSettings.findByUserId(userId);
  const dailyTokenBudget = chatSettings?.autonomousRoomSettings?.dailyTokenBudget ?? null;
  let dailyTokensSpent = 0;
  if (dailyTokenBudget != null) {
    const since = lastLocalMidnightIso(now);
    const usage = await repos.llmLogs.getTotalTokenUsageSince(userId, since);
    dailyTokensSpent = usage.totalTokens;
  }

  const budget = checkBudget(chat, now, { dailyTokenBudget, dailyTokensSpent });
  if (budget.exhausted) {
    logger.info('Autonomous-room turn: budget exhausted before turn', {
      context: HANDLER, chatId, reason: budget.reason, dailyTokensSpent, dailyTokenBudget,
    });
    await transitionRunState(chatId, budget.nextState, {
      runEndedAt: nowIso,
      runStateMessage: `budget:${budget.reason}`,
    });
    return;
  }

  // 5. Speaker selection
  const activeParticipants = getActiveCharacterParticipants(chat.participants);
  const charactersMap = new Map<string, Character>();
  for (const p of activeParticipants) {
    if (p.characterId) {
      const char = await repos.characters.findById(p.characterId);
      if (char) charactersMap.set(p.characterId, char);
    }
  }
  const messages = await repos.chats.getMessages(chatId);
  const messageEvents = messages.filter(
    (m): m is typeof m & { type: 'message' } => m.type === 'message',
  ) as unknown as MessageEvent[];
  const turnState = calculateTurnStateFromHistory({
    messages: messageEvents,
    participants: chat.participants,
    // Autonomous rooms have no user participant by definition.
    userParticipantId: null,
  });
  const selection = selectNextSpeaker(chat.participants, charactersMap, turnState, null);

  if (!selection.nextSpeakerId) {
    logger.warn('Autonomous-room turn: no eligible speaker', {
      context: HANDLER, chatId, reason: selection.reason,
    });
    await transitionRunState(chatId, 'error', {
      runEndedAt: nowIso,
      runStateMessage: `no_eligible_speaker:${selection.reason}`,
    });
    return;
  }

  const respondingParticipantId = selection.nextSpeakerId;

  // 6 / 7. Invoke the ordinary message pipeline with the autonomous-room flags.
  let turnSucceeded = false;
  try {
    const stream = await handleSendMessage(repos, chatId, userId, {
      continueMode: true,
      respondingParticipantId,
      neverPauseForUser: true,
      suppressAutomaticImages: true,
    });
    await drainStream(stream);
    turnSucceeded = true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Autonomous-room turn: handleSendMessage failed', {
      context: HANDLER, chatId, runId, respondingParticipantId, error: errorMessage,
    });
    await transitionRunState(chatId, 'error', {
      runEndedAt: new Date().toISOString(),
      runStateMessage: `turn_error:${errorMessage}`,
    });
    return;
  }

  if (!turnSucceeded) {
    return;
  }

  // 8. Post-turn bookkeeping. Re-read the chat so we increment off the freshest
  //    counters (memory-extraction or other jobs that ran inside handleSendMessage
  //    may have touched the row).
  const post = await repos.chats.findById(chatId);
  if (!post || post.currentRunId !== runId) {
    logger.info('Autonomous-room turn: superseded during turn, not re-enqueueing', {
      context: HANDLER, chatId, runId,
    });
    return;
  }

  // Token accounting: take the delta on the chat's per-chat token totals
  // (chats.totalPromptTokens + totalCompletionTokens), which the message
  // pipeline updates after each turn. Sub-task C will swap this for an
  // llm_logs-keyed accumulator once turns are tagged with `runId`.
  const totalBefore = (chat.totalPromptTokens ?? 0) + (chat.totalCompletionTokens ?? 0);
  const totalAfter = (post.totalPromptTokens ?? 0) + (post.totalCompletionTokens ?? 0);
  const turnDelta = Math.max(0, totalAfter - totalBefore);

  const newTurnsConsumed = (post.runTurnsConsumed ?? 0) + 1;
  const newTokensConsumed = (post.runTokensConsumed ?? 0) + turnDelta;

  await repos.chats.update(chatId, {
    runTurnsConsumed: newTurnsConsumed,
    runTokensConsumed: newTokensConsumed,
  } as unknown as Partial<ChatMetadataBase>);

  // 9. End-of-run check
  const postCheck = await repos.chats.findById(chatId);
  if (!postCheck || postCheck.currentRunId !== runId) {
    return;
  }
  let postDailySpent = 0;
  if (dailyTokenBudget != null) {
    const since = lastLocalMidnightIso(Date.now());
    const usage = await repos.llmLogs.getTotalTokenUsageSince(userId, since);
    postDailySpent = usage.totalTokens;
  }
  const verdict = checkBudget(postCheck, Date.now(), {
    dailyTokenBudget,
    dailyTokensSpent: postDailySpent,
  });
  if (verdict.exhausted) {
    logger.info('Autonomous-room turn: run exhausted post-turn', {
      context: HANDLER, chatId, reason: verdict.reason, turns: newTurnsConsumed, tokens: newTokensConsumed,
    });
    await transitionRunState(chatId, verdict.nextState, {
      runEndedAt: new Date().toISOString(),
      runStateMessage: `budget:${verdict.reason}`,
    });
    // 10. The host-authored 'autonomous-room-end' system message lands in
    //     Sub-task E alongside the cron-recompute. Sub-task B's verification
    //     path is the clean run-state transition; the announcement is a
    //     surface improvement on top.
    return;
  }

  // Loop continues — enqueue the next turn.
  await enqueueAutonomousRoomTurn(userId, { chatId, runId });
}
