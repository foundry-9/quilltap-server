/**
 * Mount-point storage-backend conversion
 *
 * Moves a Scriptorium document store between filesystem-backed storage
 * (mountType === 'filesystem' | 'obsidian', bytes on disk) and
 * database-backed storage (mountType === 'database', bytes inside the
 * encrypted quilltap-mount-index.db).
 *
 * Critical: the conversion preserves every doc_mount_files row and its
 * doc_mount_chunks children. Only the `source` field flips and the actual
 * bytes move. Because chunks (and their embedding BLOBs) are untouched,
 * no re-embedding is necessary after conversion.
 *
 * @module mount-index/conversion
 */

import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { DocMountPoint, DocMountFile } from '@/lib/schemas/mount-index.types';

const logger = createServiceLogger('MountIndex:Conversion');

export interface ConvertResult {
  mountPointId: string;
  filesMigrated: number;
  documentsWritten: number;
  blobsWritten: number;
  filesSkipped: number;
  errors: Array<{ relativePath: string; error: string }>;
}

export interface DeconvertResult {
  mountPointId: string;
  filesWritten: number;
  blobsWritten: number;
  bytesWritten: number;
  errors: Array<{ relativePath: string; error: string }>;
}

function mimeTypeForFileType(fileType: DocMountFile['fileType']): string {
  switch (fileType) {
    case 'pdf':
      return 'application/pdf';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'markdown':
      return 'text/markdown';
    case 'txt':
      return 'text/plain';
    case 'json':
      return 'application/json';
    case 'jsonl':
      return 'application/x-ndjson';
  }
}

function sha256OfBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function sha256OfString(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

// ============================================================================
// CONVERT: filesystem/obsidian → database
// ============================================================================

/**
 * Read every file under the mount point's basePath and move its bytes into
 * the encrypted mount-index database. Text files (markdown/txt) land in
 * doc_mount_documents; other file types (pdf, docx) land in doc_mount_blobs.
 * The doc_mount_files row and its chunks stay in place so embeddings survive.
 *
 * Does NOT delete the user's original files on disk. The caller should
 * update the mount point (mountType = 'database', basePath = '') and detach
 * the filesystem watcher after this function returns.
 */
export async function convertMountPointToDatabase(
  mountPoint: DocMountPoint
): Promise<ConvertResult> {
  if (mountPoint.mountType !== 'filesystem' && mountPoint.mountType !== 'obsidian') {
    throw new Error(
      `convertMountPointToDatabase called on non-filesystem mount point (type: ${mountPoint.mountType})`
    );
  }
  if (!mountPoint.basePath) {
    throw new Error('Cannot convert mount point with empty basePath');
  }

  const repos = getRepositories();
  const result: ConvertResult = {
    mountPointId: mountPoint.id,
    filesMigrated: 0,
    documentsWritten: 0,
    blobsWritten: 0,
    filesSkipped: 0,
    errors: [],
  };

  const files = await repos.docMountFiles.findByMountPointId(mountPoint.id);
  logger.info('Starting filesystem → database conversion', {
    mountPointId: mountPoint.id,
    basePath: mountPoint.basePath,
    fileCount: files.length,
  });

  const now = new Date().toISOString();

  for (const file of files) {
    const absolutePath = path.join(mountPoint.basePath, file.relativePath);
    try {
      let bytes: Buffer;
      try {
        bytes = await fs.readFile(absolutePath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('Source file missing during convert; dropping row and its chunks', {
          mountPointId: mountPoint.id,
          relativePath: file.relativePath,
          absolutePath,
          error: msg,
        });
        await repos.docMountChunks.deleteByFileId(file.id);
        await repos.docMountFiles.delete(file.id);
        result.filesSkipped += 1;
        result.errors.push({ relativePath: file.relativePath, error: `source missing: ${msg}` });
        continue;
      }

      if (file.fileType === 'markdown' || file.fileType === 'txt') {
        const content = bytes.toString('utf-8');
        const contentSha256 = sha256OfString(content);
        const existingDoc = await repos.docMountDocuments.findByMountPointAndPath(
          mountPoint.id,
          file.relativePath
        );
        if (existingDoc) {
          await repos.docMountDocuments.update(existingDoc.id, {
            content,
            contentSha256,
            plainTextLength: content.length,
            lastModified: now,
            fileType: file.fileType,
            fileName: file.fileName,
          });
        } else {
          await repos.docMountDocuments.create({
            mountPointId: mountPoint.id,
            relativePath: file.relativePath,
            fileName: file.fileName,
            fileType: file.fileType,
            content,
            contentSha256,
            plainTextLength: content.length,
            lastModified: now,
          });
        }
        result.documentsWritten += 1;
        logger.debug('Migrated text document into database', {
          mountPointId: mountPoint.id,
          relativePath: file.relativePath,
          bytes: bytes.length,
        });
      } else {
        // pdf, docx, or any other binary type the scanner picked up.
        // Store as a blob; bypass transcodeToWebP so original bytes survive.
        const storedMimeType = mimeTypeForFileType(file.fileType);
        const sha256 = sha256OfBuffer(bytes);
        await repos.docMountBlobs.create({
          mountPointId: mountPoint.id,
          relativePath: file.relativePath,
          originalFileName: file.fileName,
          originalMimeType: storedMimeType,
          storedMimeType,
          sha256,
          description: '',
          data: bytes,
        });
        result.blobsWritten += 1;
        logger.debug('Migrated binary file into blob storage', {
          mountPointId: mountPoint.id,
          relativePath: file.relativePath,
          fileType: file.fileType,
          bytes: bytes.length,
        });
      }

      await repos.docMountFiles.update(file.id, {
        source: 'database',
        lastModified: now,
      });
      result.filesMigrated += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(
        'Failed to migrate file during filesystem → database conversion',
        {
          mountPointId: mountPoint.id,
          relativePath: file.relativePath,
          error: msg,
        },
        err instanceof Error ? err : undefined
      );
      result.errors.push({ relativePath: file.relativePath, error: msg });
    }
  }

  logger.info('Completed filesystem → database conversion', {
    mountPointId: mountPoint.id,
    filesMigrated: result.filesMigrated,
    documentsWritten: result.documentsWritten,
    blobsWritten: result.blobsWritten,
    filesSkipped: result.filesSkipped,
    errors: result.errors.length,
  });

  return result;
}

// ============================================================================
// DECONVERT: database → filesystem
// ============================================================================

/**
 * Validate that a target path is usable as a new filesystem-backed mount
 * basePath: absolute, and either nonexistent (will be created) or an
 * existing empty writable directory.
 */
export async function validateDeconvertTarget(targetPath: string): Promise<void> {
  if (!targetPath || !path.isAbsolute(targetPath)) {
    throw new Error('Target path must be an absolute filesystem path');
  }
  let stat;
  try {
    stat = await fs.stat(targetPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      // Will be created during deconvert.
      return;
    }
    throw err;
  }
  if (!stat.isDirectory()) {
    throw new Error(`Target path exists but is not a directory: ${targetPath}`);
  }
  const entries = await fs.readdir(targetPath);
  if (entries.length > 0) {
    throw new Error(
      `Target directory is not empty: ${targetPath} (${entries.length} entries)`
    );
  }
  try {
    await fs.access(targetPath, (await import('fs')).constants.W_OK);
  } catch {
    throw new Error(`Target directory is not writable: ${targetPath}`);
  }
}

/**
 * Write every document and blob in a database-backed mount point out to
 * disk under `targetPath`, then delete the database-side rows and flip
 * each doc_mount_files row back to source='filesystem'. Chunks and their
 * embeddings are preserved. The caller should update the mount point
 * (mountType = 'filesystem', basePath = targetPath) and reattach the
 * filesystem watcher after this function returns.
 */
export async function deconvertMountPointToFilesystem(
  mountPoint: DocMountPoint,
  targetPath: string
): Promise<DeconvertResult> {
  if (mountPoint.mountType !== 'database') {
    throw new Error(
      `deconvertMountPointToFilesystem called on non-database mount point (type: ${mountPoint.mountType})`
    );
  }
  await validateDeconvertTarget(targetPath);
  await fs.mkdir(targetPath, { recursive: true });

  const repos = getRepositories();
  const result: DeconvertResult = {
    mountPointId: mountPoint.id,
    filesWritten: 0,
    blobsWritten: 0,
    bytesWritten: 0,
    errors: [],
  };

  const now = new Date().toISOString();

  logger.info('Starting database → filesystem conversion', {
    mountPointId: mountPoint.id,
    targetPath,
  });

  const documents = await repos.docMountDocuments.findByMountPointId(mountPoint.id);
  for (const doc of documents) {
    const absolutePath = path.join(targetPath, doc.relativePath);
    try {
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, doc.content, 'utf-8');
      const bytes = Buffer.byteLength(doc.content, 'utf-8');
      result.filesWritten += 1;
      result.bytesWritten += bytes;
      logger.debug('Wrote database document to disk', {
        mountPointId: mountPoint.id,
        relativePath: doc.relativePath,
        bytes,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(
        'Failed to write database document to disk',
        {
          mountPointId: mountPoint.id,
          relativePath: doc.relativePath,
          error: msg,
        },
        err instanceof Error ? err : undefined
      );
      result.errors.push({ relativePath: doc.relativePath, error: msg });
    }
  }

  const blobs = await repos.docMountBlobs.listByMountPoint(mountPoint.id);
  for (const blob of blobs) {
    const absolutePath = path.join(targetPath, blob.relativePath);
    try {
      const data = await repos.docMountBlobs.readData(blob.id);
      if (!data) {
        throw new Error('Blob bytes missing from repository');
      }
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, data);
      result.blobsWritten += 1;
      result.bytesWritten += data.length;
      logger.debug('Wrote database blob to disk', {
        mountPointId: mountPoint.id,
        relativePath: blob.relativePath,
        bytes: data.length,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(
        'Failed to write database blob to disk',
        {
          mountPointId: mountPoint.id,
          relativePath: blob.relativePath,
          error: msg,
        },
        err instanceof Error ? err : undefined
      );
      result.errors.push({ relativePath: blob.relativePath, error: msg });
    }
  }

  // Flip every file row back to source='filesystem'. Do this before purging
  // doc_mount_documents / doc_mount_blobs so a crash mid-purge leaves the
  // store in a consistent 'disk is authoritative' state.
  const files = await repos.docMountFiles.findByMountPointId(mountPoint.id);
  for (const file of files) {
    if (file.source === 'database') {
      await repos.docMountFiles.update(file.id, {
        source: 'filesystem',
        lastModified: now,
      });
    }
  }

  const documentsDeleted = await repos.docMountDocuments.deleteByMountPointId(mountPoint.id);
  const blobsDeleted = await repos.docMountBlobs.deleteByMountPointId(mountPoint.id);

  logger.info('Completed database → filesystem conversion', {
    mountPointId: mountPoint.id,
    targetPath,
    filesWritten: result.filesWritten,
    blobsWritten: result.blobsWritten,
    bytesWritten: result.bytesWritten,
    documentsDeleted,
    blobsDeleted,
    errors: result.errors.length,
  });

  return result;
}
