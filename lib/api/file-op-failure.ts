/**
 * The one HTTP answer for a failed document-store file operation.
 *
 * A `FileOpError` / `DatabaseStoreError` is a refusal the caller can act on:
 * it is returned as `{ error, code }` under the status `fileOpStatus` maps the
 * code to. Anything else is a fault: logged, and answered with a plain 500.
 *
 * Every mount-point route that runs a file op (the action dispatch, the
 * per-file item route, blob upload) calls this instead of spelling the
 * mapping in its own `catch`.
 */

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { serverError } from '@/lib/api/responses';
import { FileOpError } from '@/lib/mount-index/file-op-error';
import { DatabaseStoreError } from '@/lib/mount-index/database-store';
import { fileOpStatus } from '@/lib/mount-index/file-op-status';

/**
 * @param err   whatever the file op threw
 * @param label the attempted operation as a verb phrase ("move file")
 * @param ctx   log context for the unexpected-fault case
 */
export function fileOpFailure(
  err: unknown,
  label: string,
  ctx: Record<string, unknown>
): NextResponse {
  if (err instanceof FileOpError || err instanceof DatabaseStoreError) {
    logger.debug(`[Mount Points v1] Refused to ${label}`, { ...ctx, code: err.code });
    return NextResponse.json({ error: err.message, code: err.code }, { status: fileOpStatus(err) });
  }
  logger.error(`[Mount Points v1] Error trying to ${label}`, ctx, err instanceof Error ? err : undefined);
  return serverError(`Failed to ${label}`);
}
