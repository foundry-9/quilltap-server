/**
 * Writing a document, creating a blank one, and the one refresh every write
 * into a store is followed by.
 *
 * @module lib/documents/core/write
 */

import { logger } from '@/lib/logger';
import { writeFileWithMtimeCheck, reindexSingleFile, type ResolvedPath } from '@/lib/doc-edit';
import { enqueueEmbeddingJobsForMountPoint } from '@/lib/mount-index/embedding-scheduler';
import { getRepositories } from '@/lib/repositories/factory';
import { getErrorMessage } from '@/lib/error-utils';
import { DocumentConflictError } from './errors';
import { documentExists } from './read';

/**
 * The mtime precondition failure as minted by the three store writers
 * (`writeFileWithMtimeCheck` on disk, the database store, the mount-index
 * file store) — recognised by message, since two of them throw plain Errors.
 */
function isMtimeConflict(error: unknown): boolean {
  const message = getErrorMessage(error);
  return message.includes('mtime mismatch') || message.includes('modified by another process');
}

/**
 * Re-index, embed and refresh store stats after a write lands in a store.
 * Fire-and-forget: the caller's response never waits on it, and a failure is
 * logged, not thrown.
 *
 * The gate is `mountPointId`, not `scope`: a `scope: 'project'` write into a
 * project's official store needs the same chunk/embed pass as a
 * `document_store` write, or the file is invisible to search until the next
 * periodic scan (#133). Legacy filesystem-only project paths carry no
 * `mountPointId` and are left alone. Hard-linked siblings share the bytes
 * and get their own chunk sets rebuilt.
 */
export function afterDocumentWrite(resolved: ResolvedPath): void {
  const mountPointId = resolved.mountPointId;
  if (!mountPointId) return;
  logger.debug('afterDocumentWrite: scheduling store refresh', {
    mountPointId,
    relativePath: resolved.relativePath,
  });
  reindexSingleFile(mountPointId, resolved.relativePath, resolved.absolutePath)
    .then(async () => {
      const { reindexLinkGroupSiblings } = await import('@/lib/mount-index/link-groups');
      await reindexLinkGroupSiblings(mountPointId, resolved.relativePath);
    })
    .then(() => Promise.all([
      enqueueEmbeddingJobsForMountPoint(mountPointId),
      getRepositories().docMountPoints.refreshStats(mountPointId),
    ]))
    .catch(err => {
      logger.warn('Background re-index, embedding, or stats refresh failed after a document write', {
        mountPointId,
        path: resolved.relativePath,
        error: getErrorMessage(err),
      });
    });
}

/**
 * Write a document's content, with the mtime precondition when
 * `expectedMtime` is given, then {@link afterDocumentWrite}. A stale mtime
 * surfaces as a {@link DocumentConflictError} carrying the writer's message.
 * Creates parent folders (disk) or folder rows (database) as needed.
 */
export async function writeDocument(
  resolved: ResolvedPath,
  content: string,
  expectedMtime?: number,
): Promise<{ mtime: number }> {
  let mtime: number;
  try {
    ({ mtime } = await writeFileWithMtimeCheck(resolved, content, expectedMtime));
  } catch (error) {
    if (isMtimeConflict(error)) {
      logger.debug('writeDocument: mtime conflict', {
        relativePath: resolved.relativePath,
        mountPointId: resolved.mountPointId,
        error: getErrorMessage(error),
      });
      throw new DocumentConflictError(getErrorMessage(error));
    }
    throw error;
  }
  logger.debug('writeDocument: wrote document', {
    relativePath: resolved.relativePath,
    mountPointId: resolved.mountPointId,
    bytes: content.length,
  });
  afterDocumentWrite(resolved);
  return { mtime };
}

/**
 * Make sure a document exists at the path, creating it blank when nothing is
 * there. Creates through {@link writeDocument} — never raw `fs` — so a
 * database store gets a document row and every store its refresh.
 * `created: false` means something was already there and was left untouched.
 */
export async function ensureDocument(
  resolved: ResolvedPath,
): Promise<{ created: true; mtime: number } | { created: false }> {
  if (await documentExists(resolved)) {
    return { created: false };
  }
  const { mtime } = await writeDocument(resolved, '');
  logger.debug('ensureDocument: created a blank document', {
    relativePath: resolved.relativePath,
    mountPointId: resolved.mountPointId,
  });
  return { created: true, mtime };
}
