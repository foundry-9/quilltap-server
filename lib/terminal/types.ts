/**
 * Internal Terminal Runtime Types
 *
 * Types used internally by the PTY manager and WebSocket handler,
 * separate from the public API and database schemas.
 *
 * @module terminal/types
 */

import type { WriteStream } from 'fs';
import type { WebSocket } from 'ws';
import type { IPty } from 'node-pty';
import type { TerminalScreen } from './screen';
import type { TerminalSession, WsClientMessage, WsServerMessage } from '@/lib/schemas/terminal.types';

/**
 * Runtime metadata for an active or recently-exited PTY session
 */
export interface PtySessionMeta {
  id: string;
  chatId: string;
  label: string | null;
  shell: string;
  cwd: string;
  startedAt: string;
  exitedAt: string | null;
  exitCode: number | null;
  transcriptPath: string | null;
  /** Current terminal geometry, kept in step with `PtyManager.resize`. */
  cols: number;
  rows: number;
}

/**
 * Internal session state managed by PtyManager
 */
export interface PtySession {
  pty: IPty;
  meta: PtySessionMeta;
  ringBuffer: string;
  subscribers: Set<WebSocket>;
  transcriptStream: WriteStream | null;
  /** Server-side emulator mirroring the screen; what text read-back renders from. */
  screen: TerminalScreen;
  /** Output has arrived since the last Ariel summary flush. */
  arielPending: boolean;
  /** Tail of this session's chain of Ariel flushes (they post in order). */
  arielFlush: Promise<void>;
  /** Idle debounce: fires `ARIEL_FLUSH_IDLE_MS` after the last chunk arrived. */
  arielIdleTimer: NodeJS.Timeout | null;
  /** Max-age cap: fires `ARIEL_FLUSH_MAX_AGE_MS` after the buffer started, regardless of activity. */
  arielMaxAgeTimer: NodeJS.Timeout | null;
  /** Removes per-session shell-init artifacts (bash rcfile / zsh ZDOTDIR). Called on exit. */
  cleanupInit?: (() => void) | null;
}

export type WsClientMsg = WsClientMessage;
export type WsServerMsg = WsServerMessage;
