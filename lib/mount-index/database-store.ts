/**
 * Database-backed Document Store operations
 *
 * For mount points with mountType === 'database', document bytes live in
 * doc_mount_documents inside quilltap-mount-index.db — there is no
 * filesystem path. This module implements the same create/read/update/
 * delete/move/list operations that the filesystem path-resolver offers,
 * but routed through repositories.
 *
 * Each mutation:
 *   1. Updates the doc_mount_documents row (the source of truth).
 *   2. Keeps the mirror doc_mount_files row in sync so scan/search/
 *      embedding code continues to treat the store uniformly.
 *   3. Emits a db-store-events event so the watcher triggers an
 *      embedding re-index — the equivalent of chokidar 'change'.
 */

import path from 'path';
import { createHash } from 'crypto';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { DocMountFile, DocMountPoint } from '@/lib/schemas/mount-index.types';
import {
  emitDocumentDeleted,
  emitDocumentMoved,
  emitDocumentWritten,
} from './db-store-events';

const logger = createServiceLogger('MountIndex:DatabaseStore');

type SupportedFileType = 'markdown' | 'txt';

function detectDatabaseFileType(relativePath: string): SupportedFileType | null {
  const ext = path.extname(relativePath).toLowerCase();
  switch (ext) {
    case '.md':
    case '.markdown':
      return 'markdown';
    case '.txt':
      return 'txt';
    default:
      return null;
  }
}

function sha256OfString(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

function normaliseRelativePath(relativePath: string): string {
  // Collapse ./ and redundant separators, reject traversal. Path-resolver
  // already blocks '..' segments before we get here; keep a second guard.
  const normalised = path
    .normalize(relativePath)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (normalised.split('/').includes('..')) {
    throw new Error(`Invalid relative path: ${relativePath}`);
  }
  return normalised;
}

export class DatabaseStoreError extends Error {
  constructor(message: string, public code: 'NOT_FOUND' | 'UNSUPPORTED' | 'CONFLICT' | 'INVALID') {
    super(message);
    this.name = 'DatabaseStoreError';
  }
}

// ============================================================================
// READ
// ============================================================================

export async function readDatabaseDocument(
  mountPointId: string,
  relativePath: string
): Promise<{ content: string; mtime: number; size: number }> {
  const repos = getRepositories();
  const rel = normaliseRelativePath(relativePath);
  const doc = await repos.docMountDocuments.findByMountPointAndPath(mountPointId, rel);
  if (!doc) {
    throw new DatabaseStoreError(
      `Document not found in database-backed store: ${rel}`,
      'NOT_FOUND'
    );
  }
  logger.debug('Read database document', {
    mountPointId,
    relativePath: rel,
    size: doc.content.length,
  });
  return {
    content: doc.content,
    mtime: new Date(doc.lastModified).getTime(),
    size: doc.content.length,
  };
}

// ============================================================================
// WRITE (create or update)
// ============================================================================

export async function writeDatabaseDocument(
  mountPointId: string,
  relativePath: string,
  content: string,
  expectedMtime?: number
): Promise<{ mtime: number }> {
  const repos = getRepositories();
  const rel = normaliseRelativePath(relativePath);
  const fileType = detectDatabaseFileType(rel);
  if (!fileType) {
    throw new DatabaseStoreError(
      `Database-backed stores only accept text documents (.md, .markdown, .txt). Got: ${path.extname(rel)}`,
      'UNSUPPORTED'
    );
  }

  const existing = await repos.docMountDocuments.findByMountPointAndPath(mountPointId, rel);
  if (expectedMtime !== undefined && existing) {
    const currentMtime = new Date(existing.lastModified).getTime();
    if (currentMtime !== expectedMtime) {
      throw new DatabaseStoreError(
        `Document was modified by another process (mtime mismatch). Please reload and try again.`,
        'CONFLICT'
      );
    }
  }

  const contentSha256 = sha256OfString(content);
  const now = new Date().toISOString();
  const fileName = path.basename(rel);

  if (existing) {
    await repos.docMountDocuments.update(existing.id, {
      content,
      contentSha256,
      plainTextLength: content.length,
      lastModified: now,
      fileType,
      fileName,
    });
  } else {
    await repos.docMountDocuments.create({
      mountPointId,
      relativePath: rel,
      fileName,
      fileType,
      content,
      contentSha256,
      plainTextLength: content.length,
      lastModified: now,
    });
  }

  // Mirror into doc_mount_files so search/scan/embedding see the document.
  const existingFile = await repos.docMountFiles.findByMountPointAndPath(mountPointId, rel);
  if (existingFile) {
    await repos.docMountFiles.update(existingFile.id, {
      sha256: contentSha256,
      fileSizeBytes: Buffer.byteLength(content, 'utf-8'),
      lastModified: now,
      source: 'database',
      // Text is already "converted" — chunking happens in reindex-file.ts.
      conversionStatus: 'converted',
      conversionError: null,
      plainTextLength: content.length,
    });
  } else {
    await repos.docMountFiles.create({
      mountPointId,
      relativePath: rel,
      fileName,
      fileType,
      sha256: contentSha256,
      fileSizeBytes: Buffer.byteLength(content, 'utf-8'),
      lastModified: now,
      source: 'database',
      conversionStatus: 'converted',
      plainTextLength: content.length,
      chunkCount: 0,
    });
  }

  emitDocumentWritten({ mountPointId, relativePath: rel });

  const mtime = new Date(now).getTime();
  logger.debug('Wrote database document', {
    mountPointId,
    relativePath: rel,
    sizeBytes: Buffer.byteLength(content, 'utf-8'),
  });
  return { mtime };
}

// ============================================================================
// DELETE
// ============================================================================

export async function deleteDatabaseDocument(
  mountPointId: string,
  relativePath: string
): Promise<boolean> {
  const repos = getRepositories();
  const rel = normaliseRelativePath(relativePath);
  const doc = await repos.docMountDocuments.findByMountPointAndPath(mountPointId, rel);
  if (!doc) return false;

  await repos.docMountDocuments.delete(doc.id);

  const file = await repos.docMountFiles.findByMountPointAndPath(mountPointId, rel);
  if (file) {
    await repos.docMountChunks.deleteByFileId(file.id);
    await repos.docMountFiles.delete(file.id);
  }

  emitDocumentDeleted({ mountPointId, relativePath: rel });
  logger.debug('Deleted database document', { mountPointId, relativePath: rel });
  return true;
}

// ============================================================================
// MOVE / RENAME
// ============================================================================

export async function moveDatabaseDocument(
  mountPointId: string,
  fromRelativePath: string,
  toRelativePath: string
): Promise<void> {
  const repos = getRepositories();
  const fromRel = normaliseRelativePath(fromRelativePath);
  const toRel = normaliseRelativePath(toRelativePath);

  const existing = await repos.docMountDocuments.findByMountPointAndPath(mountPointId, fromRel);
  if (!existing) {
    throw new DatabaseStoreError(
      `Source document not found: ${fromRel}`,
      'NOT_FOUND'
    );
  }
  const fileType = detectDatabaseFileType(toRel);
  if (!fileType) {
    throw new DatabaseStoreError(
      `Target path has unsupported extension: ${path.extname(toRel)}`,
      'UNSUPPORTED'
    );
  }
  const conflict = await repos.docMountDocuments.findByMountPointAndPath(mountPointId, toRel);
  if (conflict) {
    throw new DatabaseStoreError(
      `Target already exists: ${toRel}`,
      'CONFLICT'
    );
  }

  await repos.docMountDocuments.update(existing.id, {
    relativePath: toRel,
    fileName: path.basename(toRel),
    fileType,
  });

  const existingFile = await repos.docMountFiles.findByMountPointAndPath(mountPointId, fromRel);
  if (existingFile) {
    await repos.docMountFiles.update(existingFile.id, {
      relativePath: toRel,
      fileName: path.basename(toRel),
    });
  }

  emitDocumentMoved({ mountPointId, fromRelativePath: fromRel, toRelativePath: toRel });
  logger.debug('Moved database document', {
    mountPointId,
    fromRelativePath: fromRel,
    toRelativePath: toRel,
  });
}

// ============================================================================
// LIST (for doc_list_files support)
// ============================================================================

export async function listDatabaseFiles(
  mountPointId: string,
  options: { folder?: string } = {}
): Promise<DocMountFile[]> {
  const repos = getRepositories();
  const files = await repos.docMountFiles.findByMountPointId(mountPointId);

  if (!options.folder) return files;
  const folder = options.folder.endsWith('/') ? options.folder : `${options.folder}/`;
  return files.filter(f => f.relativePath.startsWith(folder));
}

// ============================================================================
// EXISTENCE / FOLDER SEMANTICS
// ============================================================================

// Folders are implicit in a database-backed store: they exist if any
// document's relativePath starts with `<folder>/`. doc_create_folder is
// therefore a no-op, and doc_delete_folder simply verifies that no document
// lives under the given prefix.

export async function databaseDocumentExists(
  mountPointId: string,
  relativePath: string
): Promise<boolean> {
  const repos = getRepositories();
  const rel = normaliseRelativePath(relativePath);
  const doc = await repos.docMountDocuments.findByMountPointAndPath(mountPointId, rel);
  return doc !== null;
}

export async function databaseFolderHasContents(
  mountPointId: string,
  relativePath: string
): Promise<boolean> {
  const repos = getRepositories();
  const folder = normaliseRelativePath(relativePath);
  const prefix = folder.endsWith('/') ? folder : `${folder}/`;
  const documents = await repos.docMountDocuments.findByMountPointId(mountPointId);
  if (documents.some(d => d.relativePath.startsWith(prefix))) return true;
  const blobs = await repos.docMountBlobs.listByMountPoint(mountPointId, { folder: prefix });
  return blobs.length > 0;
}

/**
 * Rehydrate (rechunk) all documents in a database-backed mount point.
 * Used by the scan endpoint for DB-backed stores — the filesystem scanner
 * has nothing to walk, so the equivalent operation is to re-chunk every
 * document whose content sha has drifted from its file-record sha (or for
 * which chunks simply don't exist yet, as happens after a fresh import),
 * then emit write events so the embedding scheduler picks up the new
 * null-embedding chunks.
 */
export async function rescanDatabaseMountPoint(mountPoint: DocMountPoint): Promise<number> {
  if (mountPoint.mountType !== 'database') {
    throw new Error('rescanDatabaseMountPoint called on non-database mount point');
  }
  const repos = getRepositories();
  // Lazy import to avoid a circular dep with the doc-edit module.
  const { reindexSingleFile } = await import('@/lib/doc-edit/reindex-file');

  const documents = await repos.docMountDocuments.findByMountPointId(mountPoint.id);
  let rechunked = 0;

  for (const doc of documents) {
    const file = await repos.docMountFiles.findByMountPointAndPath(
      mountPoint.id,
      doc.relativePath
    );
    const needsRechunk =
      !file ||
      file.chunkCount === 0 ||
      file.sha256 !== doc.contentSha256;

    if (needsRechunk) {
      try {
        await reindexSingleFile(mountPoint.id, doc.relativePath, '');
        rechunked++;
      } catch (err) {
        logger.warn('Failed to re-chunk database document during rescan', {
          mountPointId: mountPoint.id,
          relativePath: doc.relativePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Still emit the write event — drives the existing embedding-scheduler
    // debouncer so any chunks (old or freshly rechunked) whose embeddings
    // are null get picked up by the background job queue.
    emitDocumentWritten({ mountPointId: mountPoint.id, relativePath: doc.relativePath });
  }
  logger.info('Rescanned database mount point', {
    mountPointId: mountPoint.id,
    documents: documents.length,
    rechunked,
  });
  return documents.length;
}
