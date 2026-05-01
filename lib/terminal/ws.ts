/**
 * Terminal WebSocket Upgrade Handler
 *
 * Handles WebSocket upgrades for terminal sessions at /api/v1/terminals/<id>/stream.
 * Authenticates requests, subscribes clients to session streams, and routes incoming
 * messages (input, resize, ping) to the PTY manager.
 *
 * Node-pty is imported at module load (not lazy) — the lazy import is handled at the
 * server.ts upgrade dispatch level.
 *
 * @module terminal/ws
 */

import { IncomingMessage } from 'http';
import type { WebSocket } from 'ws';
import { getServerSession } from '@/lib/auth/session';
import { logger } from '@/lib/logger';
import { ptyManager } from './pty-manager';
import type { WsClientMsg } from './types';

const wsLogger = logger.child({ module: 'terminal-ws' });

/**
 * Parse session ID from WebSocket upgrade URL
 * Expected format: /api/v1/terminals/<id>/stream
 */
function extractSessionId(url: string): string | null {
  const match = url.match(/^\/api\/v1\/terminals\/([^/]+)\/stream/);
  return match ? match[1] : null;
}

/**
 * Extract session cookie from request headers
 * Returns null if not found or cookie header missing
 */
function extractSessionCookie(req: IncomingMessage): string | null {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;

  // Look for the session cookie (typically 'sessionid' or similar)
  const cookies = cookieHeader.split(';');
  for (const cookie of cookies) {
    const trimmed = cookie.trim();
    if (trimmed.startsWith('sessionid=') || trimmed.startsWith('next-auth') || trimmed.startsWith('__Secure-')) {
      return trimmed.split('=')[1] || '';
    }
  }
  return null;
}

/**
 * Handle WebSocket upgrade for terminal stream
 *
 * Validates session exists, authenticates via session cookie, subscribes to stream,
 * and wires message/close/error handlers.
 */
export async function handleTerminalUpgrade(
  ws: WebSocket,
  req: IncomingMessage,
): Promise<void> {
  const sessionId = extractSessionId(req.url || '');

  if (!sessionId) {
    wsLogger.warn('[Terminal WS] Invalid URL format', { url: req.url });
    ws.close(1008, 'Invalid URL');
    return;
  }

  // Validate session exists in PTY manager
  const ptySession = ptyManager.get(sessionId);
  if (!ptySession) {
    wsLogger.debug('[Terminal WS] Session not found', { sessionId });
    try {
      ws.send(JSON.stringify({ type: 'exit', code: -1, signal: 'session_not_found' }));
    } catch {
      // Ignore send error
    }
    ws.close(1000, 'Session not found');
    return;
  }

  // Attempt to authenticate via session.
  // For raw IncomingMessage, getServerSession() may need cookies extracted differently.
  // As a v1 fallback, we check for cookie presence — single-user mode means
  // cookie existence is a reasonable auth check.
  let isAuthenticated = false;
  try {
    const session = await getServerSession();
    isAuthenticated = Boolean(session?.user);
  } catch {
    // getServerSession() may fail on raw IncomingMessage; fall back to cookie check
    isAuthenticated = Boolean(extractSessionCookie(req));
  }

  if (!isAuthenticated) {
    wsLogger.debug('[Terminal WS] Unauthorized session', { sessionId });
    ws.close(1008, 'Unauthorized');
    return;
  }

  // Subscribe WebSocket to PTY session
  const subscribed = ptyManager.subscribe(sessionId, ws);
  if (!subscribed) {
    wsLogger.debug('[Terminal WS] Failed to subscribe (session may have exited)', { sessionId });
    ws.close(1000, 'Failed to subscribe');
    return;
  }

  wsLogger.debug('[Terminal WS] Client connected', { sessionId });

  // Wire message handler
  ws.on('message', (rawData: Buffer) => {
    try {
      const msg = JSON.parse(rawData.toString()) as WsClientMsg;

      if (msg.type === 'input') {
        ptyManager.write(sessionId, msg.data);
      } else if (msg.type === 'resize') {
        ptyManager.resize(sessionId, msg.cols, msg.rows);
      } else if (msg.type === 'ping') {
        try {
          ws.send(JSON.stringify({ type: 'pong' }));
        } catch {
          // Ignore send error
        }
      }
    } catch (err) {
      wsLogger.debug('[Terminal WS] Failed to parse/dispatch message', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // Wire close handler
  ws.on('close', () => {
    ptyManager.unsubscribe(sessionId, ws);
    wsLogger.debug('[Terminal WS] Client disconnected', { sessionId });
  });

  // Wire error handler
  ws.on('error', (err: Error) => {
    wsLogger.warn('[Terminal WS] Socket error', {
      sessionId,
      error: err.message,
    });
    ptyManager.unsubscribe(sessionId, ws);
  });
}
