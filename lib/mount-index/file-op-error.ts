/**
 * Shared error type for mount-point file operations.
 *
 * Lives in its own leaf module (no other imports) so the canonical write
 * pipeline (`store-file.ts`), the path utilities (`path-utils.ts`), the
 * cross-mount operations (`file-ops.ts`), and the HTTP status mapper
 * (`file-op-status.ts`) can all share one error class without an import cycle.
 * `file-ops.ts` re-exports `FileOpError` so existing
 * `import { FileOpError } from '@/lib/mount-index/file-ops'` call sites keep
 * working.
 */

export type FileOpErrorCode =
  | 'SOURCE_NOT_FOUND'
  | 'DEST_EXISTS'
  | 'MOUNT_NOT_FOUND'
  | 'INVALID_PATH'
  | 'UNSUPPORTED'
  | 'VERIFY_FAILED'
  | 'CONFLICT';

export class FileOpError extends Error {
  constructor(
    message: string,
    public code: FileOpErrorCode
  ) {
    super(message);
    this.name = 'FileOpError';
  }
}
