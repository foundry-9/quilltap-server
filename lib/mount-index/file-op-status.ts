/**
 * Maps mount-point file-operation error codes to HTTP status codes.
 *
 * Shared by every route that surfaces `FileOpError` / `DatabaseStoreError`
 * (the mount-point action dispatch and the canonical per-file item route) so
 * the status mapping stays in one place. Previously this lived inline in
 * `app/api/v1/mount-points/[id]/route.ts`.
 */

import { FileOpError } from './file-op-error';
import { DatabaseStoreError } from './database-store';

/**
 * Resolve the HTTP status for a thrown file-operation error. Defaults to 500
 * for anything unrecognised so genuine bugs surface as server errors.
 */
export function fileOpStatus(err: unknown): number {
  const code =
    err instanceof FileOpError || err instanceof DatabaseStoreError
      ? err.code
      : undefined;

  switch (code) {
    case 'MOUNT_NOT_FOUND':
    case 'SOURCE_NOT_FOUND':
    case 'NOT_FOUND':
      return 404;
    case 'DEST_EXISTS':
    case 'CONFLICT':
    case 'NOT_EMPTY':
      return 409;
    case 'INVALID_PATH':
    case 'INVALID':
    case 'UNSUPPORTED':
      return 400;
    case 'VERIFY_FAILED':
    default:
      return 500;
  }
}
