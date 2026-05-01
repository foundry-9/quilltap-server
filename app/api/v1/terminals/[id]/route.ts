/**
 * Terminals API v1 - Item Endpoint
 *
 * GET /api/v1/terminals/[id] - Get session metadata and ring buffer
 * POST /api/v1/terminals/[id]?action=kill - Terminate a session
 * POST /api/v1/terminals/[id]?action=signal - Send a signal to a session
 * POST /api/v1/terminals/[id]?action=write - Write input to a session (fallback)
 * DELETE /api/v1/terminals/[id] - Delete a session
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createContextParamsHandler } from '@/lib/api/middleware';
import { withActionDispatch } from '@/lib/api/middleware/actions';
import { successResponse, badRequest, notFound, serverError } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { ptyManager } from '@/lib/terminal/pty-manager';
import { postArielSessionClosedAnnouncement } from '@/lib/services/ariel-notifications';
import { getRepositories } from '@/lib/repositories/factory';
import type { RequestContext } from '@/lib/api/middleware';

const terminalLogger = logger.child({ module: 'terminals-api' });

interface RouteParams extends Record<string, string> {
  id: string;
}

const signalSchema = z.object({
  signal: z.enum(['SIGINT', 'SIGTERM', 'SIGHUP']),
});

const writeSchema = z.object({
  data: z.string(),
});

/**
 * GET /api/v1/terminals/[id]
 *
 * Get session metadata and the ring buffer (live data).
 */
async function handleGetSession(
  request: NextRequest,
  context: RequestContext,
  params: RouteParams,
): Promise<NextResponse> {
  try {
    const { id } = params;

    terminalLogger.debug('[Terminals API] Getting session', { sessionId: id });

    const ptySession = ptyManager.get(id);
    if (!ptySession) {
      return notFound('Terminal session');
    }

    const ringBuffer = ptyManager.getRingBuffer(id);

    return successResponse({
      session: ptySession.meta,
      ringBuffer,
    });
  } catch (error) {
    terminalLogger.error('[Terminals API] Error getting session', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to get terminal session');
  }
}

/**
 * POST /api/v1/terminals/[id]?action=kill
 *
 * Send SIGTERM to a session.
 */
async function handleKill(
  request: NextRequest,
  context: RequestContext,
  params: RouteParams,
): Promise<NextResponse> {
  try {
    const { id } = params;

    terminalLogger.debug('[Terminals API] Killing session', { sessionId: id });

    ptyManager.kill(id, 'SIGTERM');

    return successResponse({ ok: true });
  } catch (error) {
    terminalLogger.error('[Terminals API] Error killing session', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to kill session');
  }
}

/**
 * POST /api/v1/terminals/[id]?action=signal
 *
 * Send a custom signal to a session.
 */
async function handleSignal(
  request: NextRequest,
  context: RequestContext,
  params: RouteParams,
): Promise<NextResponse> {
  try {
    const { id } = params;
    const body = await request.json();
    const validated = signalSchema.parse(body);

    terminalLogger.debug('[Terminals API] Sending signal', {
      sessionId: id,
      signal: validated.signal,
    });

    ptyManager.kill(id, validated.signal);

    return successResponse({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return badRequest('Invalid request', error.issues);
    }
    terminalLogger.error('[Terminals API] Error sending signal', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to send signal');
  }
}

/**
 * POST /api/v1/terminals/[id]?action=write
 *
 * Write input to a session (fallback when WebSocket unavailable).
 */
async function handleWrite(
  request: NextRequest,
  context: RequestContext,
  params: RouteParams,
): Promise<NextResponse> {
  try {
    const { id } = params;
    const body = await request.json();
    const validated = writeSchema.parse(body);

    terminalLogger.debug('[Terminals API] Writing to session', {
      sessionId: id,
      dataLen: validated.data.length,
    });

    const success = ptyManager.write(id, validated.data);
    if (!success) {
      return notFound('Terminal session');
    }

    return successResponse({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return badRequest('Invalid request', error.issues);
    }
    terminalLogger.error('[Terminals API] Error writing to session', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to write to session');
  }
}

/**
 * DELETE /api/v1/terminals/[id]
 *
 * Kill and delete a session.
 */
async function handleDelete(
  request: NextRequest,
  context: RequestContext,
  params: RouteParams,
): Promise<NextResponse> {
  try {
    const { id } = params;

    terminalLogger.debug('[Terminals API] Deleting session', { sessionId: id });

    const ptySession = ptyManager.get(id);
    if (!ptySession) {
      return notFound('Terminal session');
    }

    // Post close announcement before deletion
    await postArielSessionClosedAnnouncement({
      chatId: ptySession.meta.chatId,
      sessionId: id,
      exitCode: ptySession.meta.exitCode,
    });

    // Kill the session
    ptyManager.kill(id, 'SIGTERM');

    // Delete from database
    const repos = getRepositories() as any;
    await repos.terminalSessions.delete(id);

    terminalLogger.info('[Terminals API] Session deleted', { sessionId: id });

    return successResponse({ ok: true });
  } catch (error) {
    terminalLogger.error('[Terminals API] Error deleting session', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to delete terminal session');
  }
}

export const GET = createContextParamsHandler<RouteParams>(handleGetSession);

export const POST = createContextParamsHandler<RouteParams>(
  withActionDispatch(
    {
      kill: handleKill,
      signal: handleSignal,
      write: handleWrite,
    },
    async (_request, _context, _params) => badRequest('Missing or invalid action parameter'),
  ),
);

export const DELETE = createContextParamsHandler<RouteParams>(handleDelete);
