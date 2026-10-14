/**
 * Cold-open retry ladder for the sibling SQLCipher databases.
 *
 * A data directory on a bind-mounted iCloud Drive / VirtioFS volume can hand
 * back incomplete page-1 bytes on the first read of a database file and the
 * right bytes a moment later. One failed attempt used to lock a sibling
 * database into degraded mode for the whole process. Both the mount index and
 * the LLM logs open through this one ladder so the two cannot drift again
 * (bug 180: the LLM logs had been left with a single attempt).
 *
 * @module lib/database/backends/sqlite/cold-open-retry
 */

import { sleepSync } from '@/lib/utils/sleep';
import type { logger } from '@/lib/logger';

/** Backoff between attempts; the attempt budget is one more than its length. */
export const COLD_OPEN_RETRY_BACKOFF_MS: readonly number[] = [200, 600, 1500];

type ModuleLogger = ReturnType<typeof logger.child>;

export type ColdOpenResult<T> =
  | { ok: true; value: T; attempts: number }
  | { ok: false; error: unknown; attempts: number };

/**
 * Run `attempt` until it returns or the budget is spent, logging a WARN
 * `<label> cold-open failed — retrying` before each backoff. `attempt` must
 * close anything it opened before throwing. Never throws; the caller decides
 * what a spent budget means (both siblings enter degraded mode).
 */
export function openWithColdOpenRetry<T>(
  label: string,
  path: string,
  moduleLogger: ModuleLogger,
  attempt: () => T,
  backoffMs: readonly number[] = COLD_OPEN_RETRY_BACKOFF_MS,
): ColdOpenResult<T> {
  const maxAttempts = backoffMs.length + 1;
  let lastError: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return { ok: true, value: attempt(), attempts: i + 1 };
    } catch (error) {
      lastError = error;
      const backoff = backoffMs[i];
      if (backoff !== undefined) {
        moduleLogger.warn(`${label} cold-open failed — retrying`, {
          path,
          attempt: i + 1,
          maxAttempts,
          backoffMs: backoff,
          error: error instanceof Error ? error.message : String(error),
        });
        sleepSync(backoff);
      }
    }
  }
  return { ok: false, error: lastError, attempts: maxAttempts };
}
