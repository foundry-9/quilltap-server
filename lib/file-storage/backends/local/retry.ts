/**
 * Retry helper for transient filesystem errors on the local backend.
 *
 * Mirrors the cold-open retry logic added in lib/database/backends/sqlite/
 * mount-index-client.ts and lib/startup/db-encryption-state.ts, but for the
 * fs/promises calls that back the local file storage backend.
 *
 * Why this exists:
 *   When Docker Desktop on macOS bind-mounts a directory that lives on
 *   iCloud Drive (or any path under ~/Library/Mobile Documents), reads from
 *   inside the Linux container intermittently fail with EDEADLK ("Resource
 *   deadlock avoided") or EAGAIN. The file is materialized on disk and the
 *   metadata layer (`ls`, `stat`) sees it just fine — only `read()` racing
 *   Apple's file-provider extension via VirtioFS aborts. Re-issuing the
 *   read after a short backoff almost always succeeds.
 *
 *   This helper wraps each fs op so a single transient error doesn't
 *   surface as a broken avatar / failed image fetch / missing thumbnail.
 *
 * @module file-storage/backends/local/retry
 */

import { createLogger } from '../../../logging/create-logger';

const logger = createLogger('file-storage:local:retry');

/**
 * Filesystem error codes that are worth retrying.
 *
 * EAGAIN / EBUSY / EWOULDBLOCK / EINTR are classic transient signals on any
 * host. EDEADLK is what Docker Desktop's VirtioFS layer emits inside a Linux
 * container when the host file lives on macOS iCloud Drive and Apple's
 * file-provider extension races the FUSE read. The file is fine — the next
 * attempt almost always succeeds once the file provider settles.
 */
const TRANSIENT_FS_CODES = new Set([
  'EAGAIN',
  'EBUSY',
  'EWOULDBLOCK',
  'EINTR',
  'EDEADLK',
]);

/**
 * Numeric errno fallback. libuv on Linux has no symbolic name for EDEADLK
 * (errno 35), so the error surfaces with `code: 'Unknown system error -35'`
 * and only the numeric `errno: -35` is reliable. Match those numerically so
 * the iCloud-via-VirtioFS case actually triggers the retry.
 *
 * Values are libuv's negative errnos:
 *   -4  EINTR
 *   -11 EAGAIN / EWOULDBLOCK (Linux)
 *   -16 EBUSY (Linux)
 *   -35 EDEADLK (Linux) / EAGAIN (macOS) — both transient
 */
const TRANSIENT_FS_ERRNOS = new Set([-4, -11, -16, -35]);

const RETRY_BACKOFF_MS = [50, 150, 400, 800, 1500];
const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length + 1;

function isTransientFsError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && TRANSIENT_FS_CODES.has(code)) {
    return true;
  }
  const errno = (err as { errno?: unknown }).errno;
  if (typeof errno === 'number' && TRANSIENT_FS_ERRNOS.has(errno)) {
    return true;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface FsRetryContext {
  /** Name of the operation being retried (e.g. 'download', 'upload'). */
  operation: string;
  /** Storage key being touched, when applicable — for log correlation only. */
  key?: string;
}

/**
 * Wrap an async filesystem operation with retry/backoff on transient errors.
 *
 * Non-transient errors (ENOENT, EACCES, EIO, ENOTEMPTY, etc.) are rethrown
 * immediately so callers that key on specific error codes — for example,
 * the ENOENT-as-not-found pattern in `delete`, `exists`, and `list` — keep
 * working without changes.
 *
 * After exhausting retries the last transient error is rethrown unchanged
 * so callers see the original code/stack.
 */
export async function withFsRetry<T>(
  op: () => Promise<T>,
  context: FsRetryContext,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await op();
    } catch (err) {
      lastError = err;
      if (!isTransientFsError(err)) {
        throw err;
      }
      const backoff = RETRY_BACKOFF_MS[attempt];
      if (backoff === undefined) {
        break;
      }
      logger.warn('Transient filesystem error — retrying', {
        ...context,
        attempt: attempt + 1,
        maxAttempts: MAX_ATTEMPTS,
        backoffMs: backoff,
        code: (err as { code?: string }).code,
        error: err instanceof Error ? err.message : String(err),
      });
      await sleep(backoff);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(
        `Exhausted retries for ${context.operation}: ${String(lastError)}`,
      );
}
