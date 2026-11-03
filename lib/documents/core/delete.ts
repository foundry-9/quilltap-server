/**
 * Deleting a document from its store.
 *
 * @module lib/documents/core/delete
 */

import { logger } from '@/lib/logger';
import { deleteResolvedFile, type ResolvedPath } from '@/lib/doc-edit';
import { deleteDatabaseDocument } from '@/lib/mount-index/database-store';
import { statDocument } from './read';

/**
 * Delete the document at a path. A database store deletes the link (and
 * garbage-collects what it pointed at — an uploaded blob included); a
 * filesystem path is unlinked. `not-a-file` means a folder sits there.
 */
export async function deleteDocument(
  resolved: ResolvedPath,
): Promise<'deleted' | 'not-found' | 'not-a-file'> {
  if (resolved.mountType === 'database' && resolved.mountPointId) {
    if (await deleteDatabaseDocument(resolved.mountPointId, resolved.relativePath)) {
      logger.debug('deleteDocument: deleted database document', {
        mountPointId: resolved.mountPointId,
        relativePath: resolved.relativePath,
      });
      return 'deleted';
    }
    return (await statDocument(resolved)) === 'folder' ? 'not-a-file' : 'not-found';
  }

  const existing = await statDocument(resolved);
  if (existing === null) return 'not-found';
  if (existing === 'folder') return 'not-a-file';
  await deleteResolvedFile(resolved);
  logger.debug('deleteDocument: deleted file', { relativePath: resolved.relativePath });
  return 'deleted';
}
