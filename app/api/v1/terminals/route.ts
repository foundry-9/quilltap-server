/**
 * Terminals API v1 - Collection Endpoint
 *
 * POST /api/v1/terminals - Spawn a new terminal session
 * GET /api/v1/terminals?chatId=<id> - List sessions for a chat
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createContextHandler } from '@/lib/api/middleware';
import { successResponse, badRequest, serverError } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { ptyManager } from '@/lib/terminal/pty-manager';
import { postArielSessionOpenedAnnouncement } from '@/lib/services/ariel-notifications';
import { getRepositories } from '@/lib/repositories/factory';

const terminalLogger = logger.child({ module: 'terminals-api' });

const spawnTerminalSchema = z.object({
  chatId: z.string().uuid(),
  label: z.string().nullable().optional(),
  shell: z.string().optional(),
  cwd: z.string().optional(),
  cols: z.number().int().positive().optional(),
  rows: z.number().int().positive().optional(),
});

/**
 * POST /api/v1/terminals
 *
 * Spawn a new terminal session and post an announcement to the chat.
 */
export const POST = createContextHandler(async (request: NextRequest) => {
  try {
    const body = await request.json();
    const validated = spawnTerminalSchema.parse(body);

    terminalLogger.debug('[Terminals API] Spawning session', {
      chatId: validated.chatId,
      shell: validated.shell,
      hasLabel: Boolean(validated.label),
    });

    const session = await ptyManager.spawn({
      chatId: validated.chatId,
      label: validated.label ?? undefined,
      shell: validated.shell,
      cwd: validated.cwd,
      cols: validated.cols,
      rows: validated.rows,
    });

    // Post announcement
    await postArielSessionOpenedAnnouncement({
      chatId: validated.chatId,
      sessionId: session.id,
      label: session.label,
      shell: session.shell,
      cwd: session.cwd,
    });

    terminalLogger.info('[Terminals API] Session spawned', {
      sessionId: session.id,
      chatId: validated.chatId,
    });

    return successResponse({ session }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return badRequest('Invalid request', error.issues);
    }
    terminalLogger.error('[Terminals API] Error spawning session', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to spawn terminal');
  }
});

/**
 * GET /api/v1/terminals?chatId=<id>
 *
 * List all terminal sessions for a specific chat.
 */
export const GET = createContextHandler(async (request: NextRequest) => {
  try {
    const chatId = request.nextUrl.searchParams.get('chatId');

    if (!chatId) {
      return badRequest('Missing required query parameter: chatId');
    }

    terminalLogger.debug('[Terminals API] Listing sessions', { chatId });

    // Get live sessions from PTY manager
    const liveSessions = ptyManager.list().filter((s) => s.chatId === chatId);

    // Get historical sessions from database (optional for v1; we'll just return live for now)
    const repos = getRepositories() as any;
    const allSessions = await repos.terminalSessions.findByChatId(chatId);

    terminalLogger.debug('[Terminals API] Sessions listed', {
      chatId,
      liveCount: liveSessions.length,
      historicalCount: allSessions.length,
    });

    return successResponse({ sessions: allSessions });
  } catch (error) {
    terminalLogger.error('[Terminals API] Error listing sessions', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to list terminals');
  }
});
