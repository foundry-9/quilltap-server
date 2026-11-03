/**
 * Reading a document in a store, and asking whether one is there.
 *
 * `readDocument` is the one read with the one blob fallback (#134): a path in
 * a database store with no document may still hold an uploaded blob — every
 * upload is one, `.md` included — and it is read through
 * `readDatabaseBlobForDocument` (a native-text upload's own bytes, otherwise
 * its converted text).
 *
 * @module lib/documents/core/read
 */

import { logger } from '@/lib/logger';
import { readFileWithMtime, statResolvedFile, type ResolvedPath } from '@/lib/doc-edit';
import {
  readDatabaseBlobForDocument,
  databaseDocumentExists,
  databaseFolderExists,
} from '@/lib/mount-index/database-store';

/** What {@link readDocument} found, and where the text came from. */
export interface DocumentRead {
  content: string;
  mtime: number;
  size: number;
  /**
   * `document` — the store's document (or the file on disk); `blob-bytes` —
   * an uploaded native-text blob's own bytes; `blob-text` — a converted
   * blob's extracted text, which is not the file's own bytes.
   */
  source: 'document' | 'blob-bytes' | 'blob-text';
  /** The blob's stored MIME type, for `blob-text`. */
  storedMimeType?: string;
}

/**
 * Read a document: the document (or disk file) at the path, else — in a
 * database store — the uploaded blob there. Throws an `ENOENT`-coded error,
 * as {@link readFileWithMtime} does, when neither is there.
 */
export async function readDocument(resolved: ResolvedPath): Promise<DocumentRead> {
  try {
    const read = await readFileWithMtime(resolved);
    return { ...read, source: 'document' };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (resolved.mountType !== 'database' || !resolved.mountPointId) throw error;
    const blob = await readDatabaseBlobForDocument(resolved.mountPointId, resolved.relativePath);
    if (!blob) throw error;
    logger.debug('readDocument: no document at path; reading the uploaded blob', {
      mountPointId: resolved.mountPointId,
      relativePath: resolved.relativePath,
      source: blob.source,
      size: blob.size,
    });
    return {
      content: blob.content,
      mtime: blob.mtime,
      size: blob.size,
      source: blob.source,
      ...(blob.storedMimeType ? { storedMimeType: blob.storedMimeType } : {}),
    };
  }
}

/**
 * What sits at a path: a `file` (a document in a database store, any regular
 * file on disk), a `folder` (a database folder row, or anything on disk that
 * is not a regular file), or nothing (`null`). An uploaded blob is not a
 * document here: it can be read and deleted, but not moved. Errors other than
 * absence (permissions, I/O) bubble.
 */
export async function statDocument(resolved: ResolvedPath): Promise<'file' | 'folder' | null> {
  if (resolved.mountType === 'database') {
    if (!resolved.mountPointId) {
      throw new Error('Database-backed ResolvedPath is missing mountPointId');
    }
    if (await databaseDocumentExists(resolved.mountPointId, resolved.relativePath)) return 'file';
    if (await databaseFolderExists(resolved.mountPointId, resolved.relativePath)) return 'folder';
    return null;
  }
  const stat = await statResolvedFile(resolved);
  if (!stat) return null;
  return stat.isFile ? 'file' : 'folder';
}

/**
 * Whether a path is taken. A database store answers for its documents; on
 * disk, anything at the path counts (a directory too), so a caller about to
 * create a file never writes over one.
 */
export async function documentExists(resolved: ResolvedPath): Promise<boolean> {
  if (resolved.mountType === 'database') {
    return (await statDocument(resolved)) === 'file';
  }
  return (await statDocument(resolved)) !== null;
}
