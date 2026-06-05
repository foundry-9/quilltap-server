/**
 * Autonomous Room API v1 (4.6 Private Character Rooms)
 *
 * Manual run-control surface for `chatType: 'autonomous'` rooms. The Salon
 * UI's autonomous-room management list and the per-room control bar both
 * dispatch through this endpoint.
 *
 * POST /api/v1/chats/[id]/autonomous-room?action=start
 *   - Manually start a run. Refuses when runState === 'running'.
 * POST /api/v1/chats/[id]/autonomous-room?action=pause
 *   - Pause the current run. The next scheduled tick re-evaluates.
 * POST /api/v1/chats/[id]/autonomous-room?action=stop
 *   - Stop the current run. Bumps currentRunId so any queued turn job
 *     exits via the stale-run guard.
 * POST /api/v1/chats/[id]/autonomous-room?action=resume
 *   - Equivalent to start; convenience for paused / budgetExhausted rooms.
 *
 * GET  /api/v1/chats/[id]/autonomous-room
 *   - Read run status snapshot for the management UI.
 */

import { NextRequest } from 'next/server';
import {
  createAuthenticatedParamsHandler,
  type AuthenticatedContext,
} from '@/lib/api/middleware';
import { withActionDispatch } from '@/lib/api/middleware/actions';
import {
  badRequest,
  notFound,
  successResponse,
  serverError,
} from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import {
  startAutonomousRoomManually,
  pauseAutonomousRoom,
  resumeAutonomousRoom,
  stopAutonomousRoom,
} from '@/lib/services/chat-message/autonomous-room.service';

const HANDLER = 'api.v1.chats.autonomous-room';

async function ensureAutonomousChat(
  ctx: AuthenticatedContext,
  chatId: string,
) {
  const chat = await ctx.repos.chats.findById(chatId);
  if (!chat) return { ok: false as const, response: notFound('Chat') };
  if (chat.chatType !== 'autonomous') {
    return {
      ok: false as const,
      response: badRequest('Chat is not an autonomous room'),
    };
  }
  return { ok: true as const, chat };
}

async function handleStart(
  _req: NextRequest,
  ctx: AuthenticatedContext,
  { id }: { id: string },
) {
  try {
    const result = await startAutonomousRoomManually(id, ctx.user.id);
    if (!result.ok) {
      if (result.reason === 'chat_not_found') return notFound('Chat');
      return badRequest(result.message);
    }
    return successResponse({ runId: result.runId, jobId: result.jobId });
  } catch (error) {
    logger.error('Manual autonomous-room start failed', {
      context: HANDLER,
      chatId: id,
      error: error instanceof Error ? error.message : String(error),
    }, error instanceof Error ? error : undefined);
    return serverError('Failed to start autonomous run');
  }
}

async function handlePause(
  _req: NextRequest,
  ctx: AuthenticatedContext,
  { id }: { id: string },
) {
  try {
    const result = await pauseAutonomousRoom(id);
    if (!result.ok) return badRequest(result.message ?? 'Pause failed');
    return successResponse({ paused: true });
  } catch (error) {
    logger.error('Autonomous-room pause failed', {
      context: HANDLER,
      chatId: id,
      error: error instanceof Error ? error.message : String(error),
    }, error instanceof Error ? error : undefined);
    return serverError('Failed to pause autonomous run');
  }
}

async function handleStop(
  _req: NextRequest,
  ctx: AuthenticatedContext,
  { id }: { id: string },
) {
  try {
    const result = await stopAutonomousRoom(id);
    if (!result.ok) return badRequest(result.message ?? 'Stop failed');
    return successResponse({ stopped: true });
  } catch (error) {
    logger.error('Autonomous-room stop failed', {
      context: HANDLER,
      chatId: id,
      error: error instanceof Error ? error.message : String(error),
    }, error instanceof Error ? error : undefined);
    return serverError('Failed to stop autonomous run');
  }
}

async function handleResume(
  _req: NextRequest,
  ctx: AuthenticatedContext,
  { id }: { id: string },
) {
  try {
    const result = await resumeAutonomousRoom(id, ctx.user.id);
    if (!result.ok) {
      if (result.reason === 'chat_not_found') return notFound('Chat');
      return badRequest(result.message);
    }
    return successResponse({ runId: result.runId, jobId: result.jobId });
  } catch (error) {
    logger.error('Autonomous-room resume failed', {
      context: HANDLER,
      chatId: id,
      error: error instanceof Error ? error.message : String(error),
    }, error instanceof Error ? error : undefined);
    return serverError('Failed to resume autonomous run');
  }
}

async function handleStatus(
  _req: NextRequest,
  ctx: AuthenticatedContext,
  { id }: { id: string },
) {
  const guard = await ensureAutonomousChat(ctx, id);
  if (!guard.ok) return guard.response;
  const c = guard.chat as unknown as Record<string, unknown>;
  return successResponse({
    chatId: id,
    chatType: 'autonomous',
    runState: c.runState ?? null,
    currentRunId: c.currentRunId ?? null,
    runStateMessage: c.runStateMessage ?? null,
    runStartedAt: c.runStartedAt ?? null,
    runEndedAt: c.runEndedAt ?? null,
    runPausedAccumMs: c.runPausedAccumMs ?? 0,
    runTurnsConsumed: c.runTurnsConsumed ?? 0,
    runTokensConsumed: c.runTokensConsumed ?? 0,
    scheduleCron: c.scheduleCron ?? null,
    scheduleNextRunAt: c.scheduleNextRunAt ?? null,
    scheduleLastRunAt: c.scheduleLastRunAt ?? null,
    scheduleFreshnessWindowMs: c.scheduleFreshnessWindowMs ?? null,
    budgetMaxTurns: c.budgetMaxTurns ?? null,
    budgetMaxTokens: c.budgetMaxTokens ?? null,
    budgetMaxWallClockMs: c.budgetMaxWallClockMs ?? null,
    budgetEstimatedSpendCapUSD: c.budgetEstimatedSpendCapUSD ?? null,
    runDestructiveToolsAllowed: c.runDestructiveToolsAllowed ?? 0,
    runVisibility: c.runVisibility ?? null,
  });
}

export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  withActionDispatch({
    start: handleStart,
    pause: handlePause,
    stop: handleStop,
    resume: handleResume,
  }),
);

export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  withActionDispatch(
    {},
    handleStatus,
  ),
);
