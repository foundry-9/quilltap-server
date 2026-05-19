/**
 * IPC message types for the background-jobs parent ⇄ child channel.
 *
 * The parent (Next.js HTTP) forks a child process that runs all 18 job
 * handlers. The parent owns the only RW SQLCipher connection and the
 * instance lock; the child opens a readonly SQLCipher connection and
 * accumulates write payloads in a per-job buffer that ships back in the
 * `job-result` message. The parent then applies the batch in a single
 * `db.transaction(...)`.
 */

import type { BackgroundJob } from '@/lib/schemas/types';

// ============================================================================
// Parent → child
// ============================================================================

/** Dispatch a claimed job to the child for execution. */
export interface ParentJobMessage {
  type: 'job';
  job: BackgroundJob;
}

/**
 * Tell the child to evict a cache entry the parent just wrote.
 * `target` selects which cache layer; `key` is the per-target identifier
 * (characterId for vectorStore, mountPointId for mountPoint).
 */
export interface ParentInvalidateMessage {
  type: 'invalidate';
  target: 'vectorStore' | 'mountPoint';
  key: string;
}

/** Begin graceful drain. Child stops accepting new jobs and exits when idle. */
export interface ParentShutdownMessage {
  type: 'shutdown';
}

/**
 * Reply to a `ChildHostRpcRequestMessage`. The parent runs the requested
 * operation against its RW connections and returns the result here.
 *
 * `requestId` mirrors the child's request so multiple in-flight RPCs
 * stay correlated.
 */
export interface ParentHostRpcResponseMessage {
  type: 'host-rpc-response';
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: { message: string; stack?: string };
}

export type ParentToChildMessage =
  | ParentJobMessage
  | ParentInvalidateMessage
  | ParentShutdownMessage
  | ParentHostRpcResponseMessage;

// ============================================================================
// Child → parent
// ============================================================================

/**
 * One repository write the child accumulated during the handler run.
 *
 * `method` is a dot-path into the parent's `repos` graph (e.g.
 * `'memories.create'`, `'chats.update'`, `'embeddingStatus.markAsEmbedded'`)
 * or a built-in extension method like `'__finalizeFile'`.
 *
 * `args` are the positional arguments the parent applies via the
 * dispatch table. Must be JSON-serialisable since they cross IPC.
 */
export interface ChildWritePayload {
  method: string;
  args: unknown[];
}

/**
 * Job finished on the child side. The parent applies `writes` in a single
 * transaction, then marks the job COMPLETED (or FAILED if the transaction
 * threw, or if `ok` is false).
 */
export interface ChildJobResultMessage {
  type: 'job-result';
  jobId: string;
  ok: boolean;
  writes: ChildWritePayload[];
  error?: { message: string; stack?: string };
}

/**
 * Forward a structured log record from the child to the parent's logger.
 * `record` is the LogRecord object the logger normally writes to its
 * transports; the parent re-emits it through the main-thread transports
 * (single file writer, no rotation races).
 */
export interface ChildLogMessage {
  type: 'log';
  record: {
    level: string;
    message: string;
    timestamp: string;
    context?: string;
    meta?: Record<string, unknown>;
  };
}

/** Periodic snapshot for `getProcessorStatus()`. */
export interface ChildStatusMessage {
  type: 'status';
  inFlight: number;
  completedSinceLast: number;
  failedSinceLast: number;
}

/** Acknowledge that the child has stopped accepting new jobs. */
export interface ChildShutdownAckMessage {
  type: 'shutdown-ack';
}

/**
 * Synchronous request from child to parent for operations the child
 * cannot perform on its readonly DB connection — primarily file-storage
 * writes that need the parent's RW SQLCipher access. The parent runs the
 * operation immediately (outside the per-job buffered-writes transaction)
 * and replies with `ParentHostRpcResponseMessage`. Side-effects committed
 * by host RPCs are NOT rolled back if the job's later buffered writes
 * fail; periodic file reconciliation cleans up any orphan blobs.
 *
 * `args` must be structured-clone-serialisable (Buffers OK because the
 * fork is configured with `serialization: 'advanced'`).
 */
export interface ChildHostRpcRequestMessage {
  type: 'host-rpc';
  requestId: string;
  method: 'uploadFile';
  args: unknown[];
}

export type ChildToParentMessage =
  | ChildJobResultMessage
  | ChildLogMessage
  | ChildStatusMessage
  | ChildShutdownAckMessage
  | ChildHostRpcRequestMessage;

// ============================================================================
// Type guards
// ============================================================================

export function isChildToParentMessage(value: unknown): value is ChildToParentMessage {
  if (!value || typeof value !== 'object') return false;
  const t = (value as { type?: unknown }).type;
  return t === 'job-result' || t === 'log' || t === 'status' || t === 'shutdown-ack' || t === 'host-rpc';
}

export function isParentToChildMessage(value: unknown): value is ParentToChildMessage {
  if (!value || typeof value !== 'object') return false;
  const t = (value as { type?: unknown }).type;
  return t === 'job' || t === 'invalidate' || t === 'shutdown' || t === 'host-rpc-response';
}
