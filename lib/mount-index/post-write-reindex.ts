/**
 * Post-write re-chunk for database-backed documents.
 *
 * A write to a database store records the document row and repoints the link;
 * it does not build the chunks that semantic search, `doc_grep`'s fallback and
 * every character's RAG context read. Each writer used to carry its own copy of
 * the follow-up — and `file-ops.writeDestBytes` carried none at all, which is
 * half of bug 156. This is the one block they all call.
 *
 * Parent-process only. Inside the forked job child a repository write is
 * buffered until the batch ships home, so `reindexSingleFile` would read back
 * content that is not committed yet; in-child writers leave chunking to the
 * next database rescan, which now finds them because `linkDocumentContent`
 * zeroes `chunkCount` whenever it repoints a link.
 *
 * Never throws: a failed re-chunk must not undo a successful write. It logs
 * and leaves the link at `chunkCount = 0`, where the rescan collects it.
 *
 * @module mount-index/post-write-reindex
 */

import { logger } from '@/lib/logger';

/**
 * Re-chunk a just-written database document and every member of its
 * hard-link group.
 *
 * @param mountPointId  The database-backed store that was written to
 * @param relativePath  The document's path within that store
 */
export async function reindexAfterDatabaseWrite(
  mountPointId: string,
  relativePath: string
): Promise<void> {
  if (process.env.QUILLTAP_JOB_CHILD === '1') return;

  // Chunk the just-written content so it is immediately searchable.
  // reindexSingleFile reads the content back out of doc_mount_documents and
  // (re)builds the link's chunks, so an overwrite re-chunks too.
  try {
    const { reindexSingleFile } = await import('@/lib/doc-edit/reindex-file');
    await reindexSingleFile(mountPointId, relativePath, '');
  } catch (chunkErr) {
    logger.warn('Failed to chunk database document after write', {
      mountPointId,
      relativePath,
      error: chunkErr instanceof Error ? chunkErr.message : String(chunkErr),
    });
  }

  // The write has already repointed every member of this file's hard-link
  // group at the new content row, but chunks are per link: without this pass a
  // sibling path would keep serving the previous revision's chunks to search
  // and to character context.
  try {
    const { reindexLinkGroupSiblings } = await import('@/lib/mount-index/link-groups');
    await reindexLinkGroupSiblings(mountPointId, relativePath);
  } catch (groupErr) {
    logger.warn('Failed to re-index hard-link group after database write', {
      mountPointId,
      relativePath,
      error: groupErr instanceof Error ? groupErr.message : String(groupErr),
    });
  }
}
