/**
 * PTY Manager
 *
 * Singleton class managing node-pty sessions, transcript I/O, and WebSocket subscriptions.
 * Handles spawning, killing, resizing, and I/O for terminal sessions.
 * All node-pty interactions are wrapped in try/catch to prevent crashes.
 *
 * @module terminal/pty-manager
 */

import type { IPty } from 'node-pty';
import { createWriteStream, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import type { WebSocket } from 'ws';
import { getFilesDir, getLogsDir } from '@/lib/paths';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import {
  postArielSessionClosedAnnouncement,
  postArielTerminalOutputAnnouncement,
} from '@/lib/services/ariel-notifications';
import { cleanTerminalOutput } from './clean-output';
import type { PtySession, PtySessionMeta, WsServerMsg } from './types';
import type { TerminalSession } from '@/lib/schemas/terminal.types';

const ptyLogger = logger.child({ module: 'pty-manager' });

const MAX_RING_BUFFER_SIZE = 256 * 1024; // 256 KB

// Ariel periodic-summary tuning.
// Idle: flush after this much quiet time since the last chunk arrived.
// Max-age: flush regardless of activity if the buffer is at least this old —
// guards against a steady drip of output (e.g. a long build) that would
// otherwise never satisfy the idle condition.
const ARIEL_FLUSH_IDLE_MS = 30_000;
const ARIEL_FLUSH_MAX_AGE_MS = 120_000;

class PtyManager {
  private sessions = new Map<string, PtySession>();

  /**
   * Flush the per-session Ariel buffer to the chat.
   *
   * Clears both timers, drains the buffer, cleans it (ANSI/backspace/CR), and
   * posts a single Ariel message with the cleaned text. Empty buffers are a
   * no-op; the writer also short-circuits whitespace-only payloads.
   *
   * Errors are swallowed — terminal I/O must not fail because chat persistence
   * had a hiccup.
   */
  private flushArielBuffer(session: PtySession, reason: 'idle' | 'max-age' | 'session-closed'): void {
    if (session.arielIdleTimer) {
      clearTimeout(session.arielIdleTimer);
      session.arielIdleTimer = null;
    }
    if (session.arielMaxAgeTimer) {
      clearTimeout(session.arielMaxAgeTimer);
      session.arielMaxAgeTimer = null;
    }

    const raw = session.arielFlushBuffer;
    if (raw.length === 0) return;
    session.arielFlushBuffer = '';

    const cleaned = cleanTerminalOutput(raw);

    postArielTerminalOutputAnnouncement({
      chatId: session.meta.chatId,
      sessionId: session.meta.id,
      cleanedOutput: cleaned,
      reason,
    })
      .then((posted) => {
        // Only nudge the client if the writer actually wrote something —
        // empty/whitespace flushes return null and there's nothing new to
        // refresh.
        if (!posted) return;
        const msg: WsServerMsg = {
          type: 'chat-update',
          chatId: session.meta.chatId,
          reason: 'ariel-terminal-output',
        };
        const payload = JSON.stringify(msg);
        session.subscribers.forEach((ws) => {
          try {
            if (ws.readyState === 1) {
              ws.send(payload);
            }
          } catch (sendErr) {
            ptyLogger.debug('[PTY] Failed to broadcast chat-update', {
              sessionId: session.meta.id,
              error: sendErr instanceof Error ? sendErr.message : String(sendErr),
            });
          }
        });
      })
      .catch((err: Error) => {
        ptyLogger.warn('[PTY] Failed to post Ariel terminal-output announcement', {
          sessionId: session.meta.id,
          reason,
          error: err.message,
        });
      });
  }

  private scheduleArielFlush(session: PtySession): void {
    if (session.arielIdleTimer) {
      clearTimeout(session.arielIdleTimer);
    }
    session.arielIdleTimer = setTimeout(() => {
      session.arielIdleTimer = null;
      this.flushArielBuffer(session, 'idle');
    }, ARIEL_FLUSH_IDLE_MS);

    if (!session.arielMaxAgeTimer) {
      session.arielMaxAgeTimer = setTimeout(() => {
        session.arielMaxAgeTimer = null;
        this.flushArielBuffer(session, 'max-age');
      }, ARIEL_FLUSH_MAX_AGE_MS);
    }
  }

  async spawn(opts: {
    chatId: string;
    label?: string;
    shell?: string;
    cwd?: string;
    cols?: number;
    rows?: number;
    env?: Record<string, string>;
  }): Promise<PtySessionMeta> {
    // Lazy import of node-pty at spawn time (not module load)
    let ptySpawn: any;
    try {
      const ptyModule = await import('node-pty');
      ptySpawn = ptyModule.spawn;
    } catch (importErr) {
      ptyLogger.error('[PTY] Failed to import node-pty', {
        error: importErr instanceof Error ? importErr.message : String(importErr),
      });
      throw new Error('node-pty module not available');
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    const shell =
      opts.shell ||
      (process.platform === 'win32'
        ? process.env.COMSPEC ?? 'powershell.exe'
        : process.env.SHELL ?? '/bin/bash');

    const cwd = opts.cwd || getFilesDir();
    const cols = opts.cols ?? 80;
    const rows = opts.rows ?? 24;
    const env = {
      ...process.env,
      ...(opts.env ?? {}),
    };

    // Transcripts live under logs/, not files/, so the user-content file watcher doesn't try
    // to index them. The general log rotator only touches combined.log/error.log by name, so
    // per-session transcripts here are safe from auto-rotation.
    const transcriptsDir = `${getLogsDir()}/terminals`;
    const transcriptPath = `${transcriptsDir}/${id}.log`;

    let transcriptStream: any = null;
    let pty: IPty | undefined;
    let ringBuffer = '';

    try {
      // Ensure transcript directory exists
      try {
        mkdirSync(transcriptsDir, { recursive: true });
      } catch (dirErr) {
        ptyLogger.warn('[PTY] Failed to create transcript directory', {
          transcriptsDir,
          error: dirErr instanceof Error ? dirErr.message : String(dirErr),
        });
      }

      // Open transcript file
      try {
        transcriptStream = createWriteStream(transcriptPath, { flags: 'a' });
      } catch (streamErr) {
        ptyLogger.warn('[PTY] Failed to open transcript stream', {
          transcriptPath,
          error: streamErr instanceof Error ? streamErr.message : String(streamErr),
        });
        transcriptStream = null;
      }

      // Spawn PTY (throws on failure; caught by outer try/catch)
      pty = ptySpawn(shell, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env,
      });
      const ptyHandle = pty!;

      const meta: PtySessionMeta = {
        id,
        chatId: opts.chatId,
        label: opts.label ?? null,
        shell,
        cwd,
        startedAt: now,
        exitedAt: null,
        exitCode: null,
        transcriptPath: transcriptStream ? transcriptPath : null,
      };

      const session: PtySession = {
        pty: ptyHandle,
        meta,
        ringBuffer,
        subscribers: new Set(),
        transcriptStream,
        arielFlushBuffer: '',
        arielIdleTimer: null,
        arielMaxAgeTimer: null,
      };

      // Wire data handler
      try {
        ptyHandle.onData((data: string) => {
          ringBuffer = (ringBuffer + data).slice(
            Math.max(0, (ringBuffer + data).length - MAX_RING_BUFFER_SIZE)
          );
          session.ringBuffer = ringBuffer;

          session.arielFlushBuffer += data;
          this.scheduleArielFlush(session);

          if (transcriptStream && (transcriptStream as any).writable !== false) {
            try {
              transcriptStream.write(data);
            } catch (writeErr) {
              ptyLogger.warn('[PTY] Transcript write failed', {
                sessionId: id,
                error: writeErr instanceof Error ? writeErr.message : String(writeErr),
              });
            }
          }

          const msg: WsServerMsg = { type: 'output', data };
          session.subscribers.forEach((ws) => {
            try {
              if (ws.readyState === 1) {
                ws.send(JSON.stringify(msg));
              }
            } catch (sendErr) {
              ptyLogger.debug('[PTY] Failed to send output to subscriber', {
                sessionId: id,
                error: sendErr instanceof Error ? sendErr.message : String(sendErr),
              });
            }
          });
        });
      } catch (handlerErr) {
        ptyLogger.error('[PTY] Failed to wire onData handler', {
          sessionId: id,
          error: handlerErr instanceof Error ? handlerErr.message : String(handlerErr),
        });
      }

      // Wire exit handler
      try {
        ptyHandle.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
          session.meta.exitedAt = new Date().toISOString();
          session.meta.exitCode = exitCode;

          // Drain any remaining buffered output so trailing bytes (and the
          // final prompt right before exit) make it into the chat before the
          // session-closed announcement lands.
          this.flushArielBuffer(session, 'session-closed');

          const msg: WsServerMsg = {
            type: 'exit',
            code: exitCode,
            signal: signal ? String(signal) : null,
          };

          session.subscribers.forEach((ws) => {
            try {
              if (ws.readyState === 1) {
                ws.send(JSON.stringify(msg));
                ws.close(1000, 'Session exited');
              }
            } catch (closeErr) {
              ptyLogger.debug('[PTY] Failed to close subscriber socket', {
                sessionId: id,
                error: closeErr instanceof Error ? closeErr.message : String(closeErr),
              });
            }
          });
          session.subscribers.clear();

          if (transcriptStream && (transcriptStream as any).writable !== false) {
            try {
              transcriptStream.end();
            } catch (endErr) {
              ptyLogger.warn('[PTY] Failed to close transcript stream', {
                sessionId: id,
                error: endErr instanceof Error ? endErr.message : String(endErr),
              });
            }
          }

          const repos = getRepositories() as any;
          repos.terminalSessions.update(id, {
            exitedAt: session.meta.exitedAt,
            exitCode: session.meta.exitCode,
          })
            .catch((err: Error) => {
              ptyLogger.error('[PTY] Failed to persist exit state', {
                sessionId: id,
                error: err.message,
              });
            });

          postArielSessionClosedAnnouncement({
            chatId: session.meta.chatId,
            sessionId: id,
            exitCode,
          }).catch((err: Error) => {
            ptyLogger.warn('[PTY] Failed to post close announcement', {
              sessionId: id,
              error: err.message,
            });
          });

          ptyLogger.info('[PTY] Session exited', {
            sessionId: id,
            exitCode,
            signal,
          });
        });
      } catch (handlerErr) {
        ptyLogger.error('[PTY] Failed to wire onExit handler', {
          sessionId: id,
          error: handlerErr instanceof Error ? handlerErr.message : String(handlerErr),
        });
      }

      // Persist to database. BaseRepository.create takes data minus id/createdAt/updatedAt
      // and stamps them itself; we pass our pre-generated id via options to keep PtyManager's
      // in-memory map and the DB row in sync.
      try {
        const repos = getRepositories() as any;
        const { id: metaId, ...createData } = meta;
        await repos.terminalSessions.create(createData, { id: metaId });
      } catch (dbErr) {
        ptyLogger.error('[PTY] Failed to persist session to database', {
          sessionId: id,
          error: dbErr instanceof Error ? dbErr.message : String(dbErr),
        });
        throw dbErr;
      }

      this.sessions.set(id, session);

      ptyLogger.info('[PTY] Session spawned', {
        sessionId: id,
        chatId: opts.chatId,
        shell,
        cwd,
        cols,
        rows,
      });

      return meta;
    } catch (error) {
      ptyLogger.error('[PTY] Failed to spawn session', {
        chatId: opts.chatId,
        shell,
        cwd,
        error: error instanceof Error ? error.message : String(error),
      });

      if (pty) {
        try {
          pty.kill();
        } catch {
          // Ignore cleanup errors
        }
      }
      if (transcriptStream && (transcriptStream as any).writable !== false) {
        try {
          transcriptStream.end();
        } catch {
          // Ignore cleanup errors
        }
      }

      throw error;
    }
  }

  get(id: string): PtySession | undefined {
    return this.sessions.get(id);
  }

  list(): PtySessionMeta[] {
    return Array.from(this.sessions.values()).map((session) => session.meta);
  }

  kill(id: string, signal: NodeJS.Signals = 'SIGTERM'): void {
    const session = this.sessions.get(id);
    if (!session) {
      ptyLogger.debug('[PTY] Kill requested for unknown session', { sessionId: id });
      return;
    }

    try {
      session.pty.kill(signal);
      ptyLogger.debug('[PTY] Kill signal sent', { sessionId: id, signal });
    } catch (err) {
      ptyLogger.warn('[PTY] Failed to send kill signal', {
        sessionId: id,
        signal,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  subscribe(id: string, ws: WebSocket): boolean {
    const session = this.sessions.get(id);
    if (!session) {
      ptyLogger.debug('[PTY] Subscribe to unknown session', { sessionId: id });
      return false;
    }

    if (session.meta.exitedAt !== null) {
      ptyLogger.debug('[PTY] Subscribe to exited session', { sessionId: id });
      return false;
    }

    session.subscribers.add(ws);

    try {
      const ringBufferMsg: WsServerMsg = { type: 'output', data: session.ringBuffer };
      ws.send(JSON.stringify(ringBufferMsg));

      const metaMsg: WsServerMsg = { type: 'meta', meta: session.meta };
      ws.send(JSON.stringify(metaMsg));

      ptyLogger.debug('[PTY] Subscriber added', {
        sessionId: id,
        subscriberCount: session.subscribers.size,
      });
    } catch (err) {
      ptyLogger.warn('[PTY] Failed to send initial messages to subscriber', {
        sessionId: id,
        error: err instanceof Error ? err.message : String(err),
      });
      session.subscribers.delete(ws);
      return false;
    }

    return true;
  }

  unsubscribe(id: string, ws: WebSocket): void {
    const session = this.sessions.get(id);
    if (!session) return;

    session.subscribers.delete(ws);

    ptyLogger.debug('[PTY] Subscriber removed', {
      sessionId: id,
      subscriberCount: session.subscribers.size,
    });

    if (session.meta.exitedAt !== null && session.subscribers.size === 0) {
      this.sessions.delete(id);
      ptyLogger.debug('[PTY] Exited session cleaned up', { sessionId: id });
    }
  }

  write(id: string, data: string): boolean {
    const session = this.sessions.get(id);
    if (!session) {
      ptyLogger.debug('[PTY] Write to unknown session', { sessionId: id });
      return false;
    }

    try {
      session.pty.write(data);
      return true;
    } catch (err) {
      ptyLogger.warn('[PTY] Failed to write to PTY', {
        sessionId: id,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (!session) {
      ptyLogger.debug('[PTY] Resize unknown session', { sessionId: id });
      return;
    }

    try {
      session.pty.resize(cols, rows);
      ptyLogger.debug('[PTY] Resized', { sessionId: id, cols, rows });
    } catch (err) {
      ptyLogger.warn('[PTY] Failed to resize PTY', {
        sessionId: id,
        cols,
        rows,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  getRingBuffer(id: string): string | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    return session.ringBuffer;
  }

  async kickAllForChat(chatId: string): Promise<void> {
    const sessionIds = Array.from(this.sessions.entries())
      .filter(([, session]) => session.meta.chatId === chatId)
      .map(([id]) => id);

    for (const id of sessionIds) {
      const session = this.sessions.get(id);
      if (session) {
        // Drain pending Ariel buffer before the map entry disappears — onExit
        // still has the closure but we want the flush to land synchronously
        // with the kick, not whenever the OS reaps the process.
        this.flushArielBuffer(session, 'session-closed');
      }
      this.kill(id, 'SIGTERM');
      this.sessions.delete(id);
    }

    ptyLogger.info('[PTY] Kicked all sessions for chat', {
      chatId,
      count: sessionIds.length,
    });
  }
}

// Pin the singleton on globalThis so dev-mode loaders that produce duplicate
// module copies (Next.js's bundler vs. the tsx loader used for server.ts)
// still see the same in-memory session map. Without this, a session spawned
// via the API route is invisible to the WebSocket upgrade handler and every
// connect immediately reports session_not_found.
const globalForPty = globalThis as unknown as { __quilltapPtyManager?: PtyManager };
export const ptyManager = globalForPty.__quilltapPtyManager ?? (globalForPty.__quilltapPtyManager = new PtyManager());
