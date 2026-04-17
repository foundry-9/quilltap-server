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

type SupportedFileType = 'markdown' | 'txt' | 'json' | 'jsonl';

function detectDatabaseFileType(relativePath: string): SupportedFileType | null {
  const ext = path.extname(relativePath).toLowerCase();
  switch (ext) {
    case '.md':
    case '.markdown':
      return 'markdown';
    case '.txt':
      return 'txt';
    case '.json':
      return 'json';
    case '.jsonl':
    case '.ndjson':
      return 'jsonl';
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
  constructor(message: string, public code: 'NOT_FOUND' | 'UNSUPPORTED' | 'CONFLICT' | 'INVALID' | 'NOT_EMPTY') {
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
      `Database-backed stores only accept text documents (.md, .markdown, .txt, .json, .jsonl, .ndjson). Got: ${path.extname(rel)}`,
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

  // Ensure folder exists and get its ID
  const { ensureFolderPath } = await import('@/lib/mount-index/folder-paths');
  const folderPath = path.dirname(rel);
  const folderId = folderPath !== '.' ? await ensureFolderPath(mountPointId, folderPath) : null;

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
      folderId,
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
      folderId,
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
      folderId,
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
      folderId,
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

  // Ensure destination folder exists and get its ID
  const { ensureFolderPath } = await import('@/lib/mount-index/folder-paths');
  const destFolderPath = path.dirname(toRel);
  const destFolderId = destFolderPath !== '.' ? await ensureFolderPath(mountPointId, destFolderPath) : null;

  await repos.docMountDocuments.update(existing.id, {
    relativePath: toRel,
    fileName: path.basename(toRel),
    fileType,
    folderId: destFolderId,
  });

  const existingFile = await repos.docMountFiles.findByMountPointAndPath(mountPointId, fromRel);
  if (existingFile) {
    await repos.docMountFiles.update(existingFile.id, {
      relativePath: toRel,
      fileName: path.basename(toRel),
      folderId: destFolderId,
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
): Promise<Array<DocMountFile & { kind?: 'file' | 'folder' }>> {
  const repos = getRepositories();
  const files = await repos.docMountFiles.findByMountPointId(mountPointId);

  // Get folders for this mount point
  const folders = await repos.docMountFolders.findByMountPointId(mountPointId);

  // Build the result entries
  const entries: Array<DocMountFile & { kind?: 'file' | 'folder' }> = [];

  if (!options.folder) {
    // Return all files with kind='file'
    for (const f of files) {
      entries.push({ ...f, kind: 'file' });
    }
    // Return all folders with kind='folder'
    for (const folder of folders) {
      entries.push({
        id: folder.id,
        mountPointId: folder.mountPointId,
        relativePath: folder.path,
        fileName: path.basename(folder.path),
        fileType: 'markdown' as const,
        sha256: '',
        fileSizeBytes: 0,
        lastModified: folder.createdAt,
        source: 'database' as const,
        conversionStatus: 'converted' as const,
        plainTextLength: 0,
        chunkCount: 0,
        folderId: folder.parentId,
        kind: 'folder',
      } as DocMountFile & { kind: 'folder' });
    }
    return entries;
  }

  // Filter to a specific folder
  const folderPrefix = options.folder.endsWith('/') ? options.folder : `${options.folder}/`;

  // Files that start with the folder prefix
  for (const f of files) {
    if (f.relativePath.startsWith(folderPrefix)) {
      entries.push({ ...f, kind: 'file' });
    }
  }

  // Folders that have this as a parent
  const folderPath = options.folder;
  for (const folder of folders) {
    if (folder.path.startsWith(folderPrefix)) {
      entries.push({
        id: folder.id,
        mountPointId: folder.mountPointId,
        relativePath: folder.path,
        fileName: path.basename(folder.path),
        fileType: 'markdown' as const,
        sha256: '',
        fileSizeBytes: 0,
        lastModified: folder.createdAt,
        source: 'database' as const,
        conversionStatus: 'converted' as const,
        plainTextLength: 0,
        chunkCount: 0,
        folderId: folder.parentId,
        kind: 'folder',
      } as DocMountFile & { kind: 'folder' });
    }
  }

  return entries;
}

// ============================================================================
// FOLDER OPERATIONS
// ============================================================================

export async function createDatabaseFolder(
  mountPointId: string,
  folderPath: string
): Promise<{ folderId: string; path: string }> {
  const rel = normaliseRelativePath(folderPath);
  const { ensureFolderPath } = await import('@/lib/mount-index/folder-paths');

  const folderId = await ensureFolderPath(mountPointId, rel);
  const resultPath = rel || '';

  logger.debug('Created database folder', {
    mountPointId,
    folderPath: resultPath,
    folderId,
  });

  return { folderId: folderId || '', path: resultPath };
}

export async function deleteDatabaseFolder(
  mountPointId: string,
  folderPath: string
): Promise<{ deleted: boolean }> {
  const rel = normaliseRelativePath(folderPath);
  const repos = getRepositories();

  // Find the folder
  const folder = await repos.docMountFolders.findByMountPointAndPath(mountPointId, rel);
  if (!folder) {
    throw new DatabaseStoreError(
      `Folder not found: ${folderPath}`,
      'NOT_FOUND'
    );
  }

  // Check if it has contents
  const { folderHasContents } = await import('@/lib/mount-index/folder-paths');
  const hasContents = await folderHasContents(mountPointId, folder.id);
  if (hasContents) {
    throw new DatabaseStoreError(
      `Folder is not empty: ${folderPath}. Only empty folders can be deleted.`,
      'NOT_EMPTY'
    );
  }

  // Delete the folder row
  await repos.docMountFolders.delete(folder.id);

  logger.debug('Deleted database folder', {
    mountPointId,
    folderPath: rel,
  });

  return { deleted: true };
}

export async function moveDatabaseFolder(
  mountPointId: string,
  fromPath: string,
  toPath: string
): Promise<void> {
  const repos = getRepositories();
  const fromRel = normaliseRelativePath(fromPath);
  const toRel = normaliseRelativePath(toPath);

  // Resolve the source folder
  const sourceFolder = await repos.docMountFolders.findByMountPointAndPath(mountPointId, fromRel);
  if (!sourceFolder) {
    throw new DatabaseStoreError(
      `Source folder not found: ${fromPath}`,
      'NOT_FOUND'
    );
  }

  // Check destination doesn't exist
  const destFolder = await repos.docMountFolders.findByMountPointAndPath(mountPointId, toRel);
  if (destFolder) {
    throw new DatabaseStoreError(
      `Destination folder already exists: ${toPath}`,
      'CONFLICT'
    );
  }

  // Ensure parent of destination exists
  const { ensureFolderPath } = await import('@/lib/mount-index/folder-paths');
  const destDir = path.dirname(toRel);
  if (destDir !== '.') {
    await ensureFolderPath(mountPointId, destDir);
  }

  // Get destination parent folder ID
  let destParentId: string | null = null;
  if (destDir !== '.') {
    const parentFolder = await repos.docMountFolders.findByMountPointAndPath(mountPointId, destDir);
    if (parentFolder) {
      destParentId = parentFolder.id;
    }
  }

  const oldPrefix = fromRel ? `${fromRel}/` : '';
  const newPrefix = toRel ? `${toRel}/` : '';

  const movedDocuments: Array<{ oldPath: string; newPath: string }> = [];

  // Update the source folder row itself
  const newName = path.basename(toRel);
  await repos.docMountFolders.update(sourceFolder.id, {
    parentId: destParentId,
    name: newName,
    path: toRel,
  });

  // Update all descendant folder paths
  const allFolders = await repos.docMountFolders.findByMountPointId(mountPointId);
  for (const folder of allFolders) {
    if (folder.id === sourceFolder.id) continue;
    if (oldPrefix && folder.path.startsWith(oldPrefix)) {
      const newPath = newPrefix + folder.path.substring(oldPrefix.length);
      await repos.docMountFolders.update(folder.id, {
        path: newPath,
      });
    }
  }

  // Update document paths and folderId
  const documents = await repos.docMountDocuments.findByMountPointId(mountPointId);
  for (const doc of documents) {
    if (oldPrefix && doc.relativePath.startsWith(oldPrefix)) {
      const newPath = newPrefix + doc.relativePath.substring(oldPrefix.length);
      const newFolderPath = path.dirname(newPath);
      let newFolderId: string | null = null;
      if (newFolderPath !== '.') {
        const newFolder = await repos.docMountFolders.findByMountPointAndPath(mountPointId, newFolderPath);
        if (newFolder) newFolderId = newFolder.id;
      }
      await repos.docMountDocuments.update(doc.id, {
        relativePath: newPath,
        fileName: path.basename(newPath),
        folderId: newFolderId,
      });
      movedDocuments.push({
        oldPath: doc.relativePath,
        newPath,
      });
    }
  }

  // Update file mirror paths and folderId
  const files = await repos.docMountFiles.findByMountPointId(mountPointId);
  for (const file of files) {
    if (oldPrefix && file.relativePath.startsWith(oldPrefix)) {
      const newPath = newPrefix + file.relativePath.substring(oldPrefix.length);
      const newFolderPath = path.dirname(newPath);
      let newFolderId: string | null = null;
      if (newFolderPath !== '.') {
        const newFolder = await repos.docMountFolders.findByMountPointAndPath(mountPointId, newFolderPath);
        if (newFolder) newFolderId = newFolder.id;
      }
      await repos.docMountFiles.update(file.id, {
        relativePath: newPath,
        fileName: path.basename(newPath),
        folderId: newFolderId,
      });
    }
  }

  // Update blob paths (blobs do not have folderId, only relativePath is updated)
  const blobs = await repos.docMountBlobs.listByMountPoint(mountPointId);
  for (const blob of blobs) {
    if (oldPrefix && blob.relativePath.startsWith(oldPrefix)) {
      const newPath = newPrefix + blob.relativePath.substring(oldPrefix.length);
      // Blob metadata update path — may not be exposed yet in the API
      // For now, skip blob path updates as blobs aren't structured in folders
    }
  }

  logger.debug('Moved database folder', {
    mountPointId,
    fromPath: fromRel,
    toPath: toRel,
    movedDocuments: movedDocuments.length,
  });

  // Emit events after all updates (don't hold locks)
  for (const doc of movedDocuments) {
    emitDocumentMoved({
      mountPointId,
      fromRelativePath: doc.oldPath,
      toRelativePath: doc.newPath,
    });
  }
}

export async function backfillFolderRowsForMountPoint(
  mountPointId: string
): Promise<{ foldersCreated: number; filesUpdated: number }> {
  const repos = getRepositories();
  const { ensureFolderPath } = await import('@/lib/mount-index/folder-paths');

  let foldersCreated = 0;
  let filesUpdated = 0;
  const createdPaths = new Set<string>();

  try {
    // Backfill from documents
    const documents = await repos.docMountDocuments.findByMountPointId(mountPointId);
    for (const doc of documents) {
      const folderPath = path.dirname(doc.relativePath);
      if (folderPath !== '.') {
        const folderId = await ensureFolderPath(mountPointId, folderPath);
        if (!createdPaths.has(folderPath)) {
          foldersCreated++;
          createdPaths.add(folderPath);
        }
        if (doc.folderId !== folderId) {
          await repos.docMountDocuments.update(doc.id, { folderId });
          filesUpdated++;
        }
      }
    }

    // Backfill from blobs (blobs don't have folderId, just ensure parent folders exist)
    const blobs = await repos.docMountBlobs.listByMountPoint(mountPointId);
    for (const blob of blobs) {
      const folderPath = path.dirname(blob.relativePath);
      if (folderPath !== '.') {
        await ensureFolderPath(mountPointId, folderPath);
        if (!createdPaths.has(folderPath)) {
          foldersCreated++;
          createdPaths.add(folderPath);
        }
      }
    }

    // Backfill from files
    const files = await repos.docMountFiles.findByMountPointId(mountPointId);
    for (const file of files) {
      const folderPath = path.dirname(file.relativePath);
      if (folderPath !== '.') {
        const folderId = await ensureFolderPath(mountPointId, folderPath);
        if (!createdPaths.has(folderPath)) {
          foldersCreated++;
          createdPaths.add(folderPath);
        }
        if (file.folderId !== folderId) {
          await repos.docMountFiles.update(file.id, { folderId });
          filesUpdated++;
        }
      }
    }

    logger.info('Backfilled folder rows for mount point', {
      mountPointId,
      foldersCreated,
      filesUpdated,
    });

    return { foldersCreated, filesUpdated };
  } catch (error) {
    logger.error('Failed to backfill folder rows for mount point', {
      mountPointId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// ============================================================================
// EXISTENCE / FOLDER SEMANTICS
// ============================================================================

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

  // Try to find the folder row first
  const folderRow = await repos.docMountFolders.findByMountPointAndPath(mountPointId, folder);
  if (folderRow) {
    const { folderHasContents } = await import('@/lib/mount-index/folder-paths');
    return folderHasContents(mountPointId, folderRow.id);
  }

  // Fallback to prefix match for legacy data without folder rows
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
