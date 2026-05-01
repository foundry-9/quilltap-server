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
}

export type WsClientMsg = WsClientMessage;
export type WsServerMsg = WsServerMessage;
