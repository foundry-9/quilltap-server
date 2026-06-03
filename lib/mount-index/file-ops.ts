/**
 * Mount-point file operations — move and copy across mounts.
 *
 * Centralises the four storage-type combinations for cross-mount file
 * operations. Database-backed mounts use `doc_mount_file_links` as the
 * hard-link primitive (one content row, many link rows). Filesystem-backed
 * mounts use POSIX `fs.link` / `fs.rename` when the source and destination
 * sit on the same device; everything else falls back to a byte copy.
 *
 * Every operation reports `sourceSha256` and `destSha256` so the caller can
 * verify the bytes survived end-to-end.
 */

import path from 'path';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import { sha256OfBuffer, sha256OfString } from '@/lib/utils/sha256';
import type { DocMountFile, DocMountFileLink, DocMountPoint } from '@/lib/schemas/mount-index.types';
import { ensureFolderPath } from './folder-paths';
import { processMountFile } from './scanner';
import {
  emitDocumentDeleted,
  emitDocumentMoved,
  emitDocumentWritten,
} from './db-store-events';
import { getRawMountIndexDatabase } from '@/lib/database/backends/sqlite/mount-index-client';

const logger = createServiceLogger('MountIndex:FileOps');

export type FileOpStrategy = 'db-link' | 'fs-link' | 'rename' | 'byte-copy';

export interface FileOpResult {
  strategy: FileOpStrategy;
  sourceSha256: string;
  destSha256: string;
  sizeBytes: number;
  sourcePath: string;
  destPath: string;
  sourceMountPointId: string;
  destMountPointId: string;
}

export interface CopyOpts {
  sourceMountPointId: string;
  sourcePath: string;
  destMountPointId: string;
  destPath: string;
  /** When true: overwrite existing destination AND skip hard-link (true byte copy). */
  force?: boolean;
}

export type MoveOpts = Omit<CopyOpts, 'force'>;

export class FileOpError extends Error {
  constructor(
    message: string,
    public code:
      | 'SOURCE_NOT_FOUND'
      | 'DEST_EXISTS'
      | 'MOUNT_NOT_FOUND'
      | 'INVALID_PATH'
      | 'UNSUPPORTED'
      | 'VERIFY_FAILED'
  ) {
    super(message);
    this.name = 'FileOpError';
  }
}

// ============================================================================
// Path helpers
// ============================================================================

function normaliseRelativePath(input: string): string {
  const normalised = path
    .normalize(input)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  if (!normalised || normalised === '.') {
    throw new FileOpError(`Invalid relative path: ${input}`, 'INVALID_PATH');
  }
  if (normalised.split('/').includes('..')) {
    throw new FileOpError(`Path traversal not allowed: ${input}`, 'INVALID_PATH');
  }
  return normalised;
}

async function loadMount(mountPointId: string): Promise<DocMountPoint> {
  const repos = getRepositories();
  const mp = await repos.docMountPoints.findById(mountPointId);
  if (!mp) {
    throw new FileOpError(`Mount point not found: ${mountPointId}`, 'MOUNT_NOT_FOUND');
  }
  return mp;
}

function isFilesystemMount(mp: DocMountPoint): boolean {
  return mp.mountType === 'filesystem' || mp.mountType === 'obsidian';
}

function resolveFsAbsolute(mp: DocMountPoint, relativePath: string): string {
  if (!mp.basePath) {
    throw new FileOpError(
      `Filesystem mount has no basePath configured: ${mp.id}`,
      'INVALID_PATH'
    );
  }
  const abs = path.resolve(mp.basePath, relativePath);
  const base = path.resolve(mp.basePath);
  const baseWithSep = base.endsWith(path.sep) ? base : base + path.sep;
  if (abs !== base && !abs.startsWith(baseWithSep)) {
    throw new FileOpError(
      `Path escapes mount boundary: ${relativePath}`,
      'INVALID_PATH'
    );
  }
  return abs;
}

// ============================================================================
// Existence checks
// ============================================================================

async function sourceExistsOrThrow(
  mp: DocMountPoint,
  relativePath: string
): Promise<{ absolutePath?: string; linkId?: string; fileId?: string; sha256: string; sizeBytes: number }> {
  const repos = getRepositories();
  const link = await repos.docMountFileLinks.findByMountPointAndPath(mp.id, relativePath);
  if (link) {
    return {
      linkId: link.id,
      fileId: link.fileId,
      sha256: link.sha256,
      sizeBytes: link.fileSizeBytes,
      absolutePath: isFilesystemMount(mp) ? resolveFsAbsolute(mp, relativePath) : undefined,
    };
  }
  // Filesystem source may not yet be indexed (file dropped on disk between
  // scans). Tolerate this by computing the sha on the fly.
  if (isFilesystemMount(mp)) {
    const abs = resolveFsAbsolute(mp, relativePath);
    try {
      const stat = await fs.stat(abs);
      if (!stat.isFile()) {
        throw new FileOpError(`Source is not a file: ${relativePath}`, 'SOURCE_NOT_FOUND');
      }
      const bytes = await fs.readFile(abs);
      return {
        absolutePath: abs,
        sha256: sha256OfBuffer(bytes),
        sizeBytes: stat.size,
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new FileOpError(`Source not found: ${relativePath}`, 'SOURCE_NOT_FOUND');
      }
      throw err;
    }
  }
  throw new FileOpError(`Source not found: ${relativePath}`, 'SOURCE_NOT_FOUND');
}

async function destExists(mp: DocMountPoint, relativePath: string): Promise<boolean> {
  const repos = getRepositories();
  const link = await repos.docMountFileLinks.findByMountPointAndPath(mp.id, relativePath);
  if (link) return true;
  if (isFilesystemMount(mp)) {
    try {
      await fs.access(resolveFsAbsolute(mp, relativePath));
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

// ============================================================================
// Source byte read
// ============================================================================

async function readSourceBytes(
  mp: DocMountPoint,
  relativePath: string,
  link: { fileId?: string; sha256: string; absolutePath?: string } | null
): Promise<Buffer> {
  if (isFilesystemMount(mp)) {
    const abs = link?.absolutePath ?? resolveFsAbsolute(mp, relativePath);
    return fs.readFile(abs);
  }
  // Database-backed: pull from documents (text) or blobs (binary).
  const repos = getRepositories();
  if (link?.fileId) {
    const doc = await repos.docMountDocuments.findByFileId(link.fileId);
    if (doc) {
      return Buffer.from(doc.content, 'utf-8');
    }
    const bytes = await repos.docMountBlobs.readDataByFileId(link.fileId);
    if (bytes) return bytes;
  }
  throw new FileOpError(
    `Source content missing: ${relativePath}`,
    'SOURCE_NOT_FOUND'
  );
}

// ============================================================================
// File type detection
// ============================================================================

type NativeTextType = 'markdown' | 'txt' | 'json' | 'jsonl';

function detectNativeText(relativePath: string): NativeTextType | null {
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

function mimeForExtension(relativePath: string): string {
  const ext = path.extname(relativePath).toLowerCase();
  switch (ext) {
    case '.md':
    case '.markdown':
      return 'text/markdown; charset=utf-8';
    case '.txt':
      return 'text/plain; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.jsonl':
    case '.ndjson':
      return 'application/jsonl; charset=utf-8';
    case '.webp':
      return 'image/webp';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.svg':
      return 'image/svg+xml';
    case '.pdf':
      return 'application/pdf';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    default:
      return 'application/octet-stream';
  }
}

// ============================================================================
// Hard-link the same fileId into a second (mountPointId, relativePath)
// ============================================================================

/**
 * Insert a new doc_mount_file_links row pointing at an existing fileId. Used
 * for true hard links on database-backed mounts (and on filesystem mounts
 * after fs.link has placed the bytes at a second location).
 */
async function insertLinkRow(input: {
  fileId: string;
  source: DocMountFile['source'];
  fileType: DocMountFile['fileType'];
  mountPointId: string;
  relativePath: string;
  fileName: string;
  folderId: string | null;
  originalFileName?: string | null;
  originalMimeType?: string | null;
  description?: string;
  conversionStatus?: DocMountFileLink['conversionStatus'];
  plainTextLength?: number | null;
  lastModified?: string;
}): Promise<string> {
  const db = getRawMountIndexDatabase();
  if (!db) throw new FileOpError('Mount index database unavailable', 'UNSUPPORTED');

  const now = new Date().toISOString();
  const linkId = randomUUID();
  const conversionStatus =
    input.conversionStatus ??
    (input.fileType === 'blob' ? 'skipped'
      : input.fileType === 'pdf' || input.fileType === 'docx' ? 'pending'
      : 'converted');

  db.prepare(
    `INSERT INTO doc_mount_file_links (
       id, fileId, mountPointId, relativePath, fileName, folderId,
       originalFileName, originalMimeType,
       description, descriptionUpdatedAt,
       conversionStatus, conversionError, plainTextLength,
       extractedText, extractedTextSha256, extractionStatus, extractionError,
       chunkCount, lastModified, createdAt, updatedAt
     ) VALUES (
       ?, ?, ?, ?, ?, ?,
       ?, ?,
       ?, NULL,
       ?, NULL, ?,
       NULL, NULL, 'none', NULL,
       0, ?, ?, ?
     )`
  ).run(
    linkId,
    input.fileId,
    input.mountPointId,
    input.relativePath,
    input.fileName,
    input.folderId,
    input.originalFileName ?? null,
    input.originalMimeType ?? null,
    input.description ?? '',
    conversionStatus,
    input.plainTextLength ?? null,
    input.lastModified ?? now,
    now,
    now
  );
  return linkId;
}

// ============================================================================
// Verification
// ============================================================================

async function computeDestSha256(
  mp: DocMountPoint,
  relativePath: string
): Promise<string> {
  if (isFilesystemMount(mp)) {
    const bytes = await fs.readFile(resolveFsAbsolute(mp, relativePath));
    return sha256OfBuffer(bytes);
  }
  const repos = getRepositories();
  const link = await repos.docMountFileLinks.findByMountPointAndPath(mp.id, relativePath);
  if (!link) {
    throw new FileOpError(
      `Destination not visible after write: ${relativePath}`,
      'VERIFY_FAILED'
    );
  }
  return link.sha256;
}

// ============================================================================
// Public API: copyFile / moveFile
// ============================================================================

export async function copyFile(opts: CopyOpts): Promise<FileOpResult> {
  const sourceMount = await loadMount(opts.sourceMountPointId);
  const destMount = await loadMount(opts.destMountPointId);
  const sourceRel = normaliseRelativePath(opts.sourcePath);
  const destRel = normaliseRelativePath(opts.destPath);

  const sourceInfo = await sourceExistsOrThrow(sourceMount, sourceRel);

  if (await destExists(destMount, destRel)) {
    if (!opts.force) {
      throw new FileOpError(
        `Destination already exists: ${destRel}. Use --force to overwrite.`,
        'DEST_EXISTS'
      );
    }
    // Force overwrite: remove the existing destination first so write paths
    // don't have to special-case overwrite semantics on every storage type.
    await deleteAtDest(destMount, destRel);
  }

  // Same mount and same path is a no-op; reject so the caller doesn't
  // accidentally garbage-collect both ends in the move flow.
  if (sourceMount.id === destMount.id && sourceRel === destRel) {
    throw new FileOpError(
      `Source and destination are the same path: ${destRel}`,
      'INVALID_PATH'
    );
  }

  const sourceIsFs = isFilesystemMount(sourceMount);
  const destIsFs = isFilesystemMount(destMount);

  let strategy: FileOpStrategy;
  let destSha: string;
  let sizeBytes = sourceInfo.sizeBytes;

  if (!sourceIsFs && !destIsFs) {
    // DB -> DB: hard-link by inserting a new link row that shares the
    // existing content fileId. Force triggers a true byte rewrite, but in a
    // content-addressed store the resulting sha is identical, so the
    // observable end-state matches either way.
    if (!sourceInfo.fileId) {
      throw new FileOpError(
        `Source file has no content row: ${sourceRel}`,
        'SOURCE_NOT_FOUND'
      );
    }
    if (opts.force) {
      const bytes = await readSourceBytes(sourceMount, sourceRel, sourceInfo);
      destSha = await writeDestBytes(destMount, destRel, bytes, sourceMount, sourceRel);
      strategy = 'byte-copy';
    } else {
      await hardLinkDbToDb({
        sourceFileId: sourceInfo.fileId,
        sourceLinkId: sourceInfo.linkId!,
        destMountPointId: destMount.id,
        destRelativePath: destRel,
      });
      destSha = sourceInfo.sha256;
      strategy = 'db-link';
    }
  } else if (sourceIsFs && destIsFs) {
    // FS -> FS: prefer hard link when same device and !force; otherwise byte copy.
    const sourceAbs = sourceInfo.absolutePath!;
    const destAbs = resolveFsAbsolute(destMount, destRel);
    await fs.mkdir(path.dirname(destAbs), { recursive: true });

    let linked = false;
    if (!opts.force) {
      try {
        await fs.link(sourceAbs, destAbs);
        linked = true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
        // Cross-device: fall through to byte copy.
      }
    }
    if (!linked) {
      await fs.copyFile(sourceAbs, destAbs);
    }
    // Index the new path so search/list pick it up.
    await processMountFile(destMount, destAbs, destRel).catch(err => {
      logger.warn('processMountFile after fs copy failed', {
        mountPointId: destMount.id,
        relativePath: destRel,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    const destBytes = await fs.readFile(destAbs);
    destSha = sha256OfBuffer(destBytes);
    sizeBytes = destBytes.length;
    strategy = linked ? 'fs-link' : 'byte-copy';
  } else {
    // Cross-storage (FS <-> DB): byte copy through the appropriate writer.
    const bytes = await readSourceBytes(sourceMount, sourceRel, sourceInfo);
    destSha = await writeDestBytes(destMount, destRel, bytes, sourceMount, sourceRel);
    sizeBytes = bytes.length;
    strategy = 'byte-copy';
  }

  if (destSha !== sourceInfo.sha256) {
    throw new FileOpError(
      `Checksum mismatch after copy: source ${sourceInfo.sha256} != dest ${destSha}`,
      'VERIFY_FAILED'
    );
  }

  logger.info('Copied file', {
    sourceMountPointId: sourceMount.id,
    sourcePath: sourceRel,
    destMountPointId: destMount.id,
    destPath: destRel,
    strategy,
    sizeBytes,
  });

  return {
    strategy,
    sourceSha256: sourceInfo.sha256,
    destSha256: destSha,
    sizeBytes,
    sourcePath: sourceRel,
    destPath: destRel,
    sourceMountPointId: sourceMount.id,
    destMountPointId: destMount.id,
  };
}

export async function moveFile(opts: MoveOpts): Promise<FileOpResult> {
  const sourceMount = await loadMount(opts.sourceMountPointId);
  const destMount = await loadMount(opts.destMountPointId);
  const sourceRel = normaliseRelativePath(opts.sourcePath);
  const destRel = normaliseRelativePath(opts.destPath);

  if (sourceMount.id === destMount.id && sourceRel === destRel) {
    throw new FileOpError(
      `Source and destination are the same path: ${destRel}`,
      'INVALID_PATH'
    );
  }

  const sourceInfo = await sourceExistsOrThrow(sourceMount, sourceRel);

  if (await destExists(destMount, destRel)) {
    throw new FileOpError(
      `Destination already exists: ${destRel}. Move will not overwrite.`,
      'DEST_EXISTS'
    );
  }

  const sourceIsFs = isFilesystemMount(sourceMount);
  const destIsFs = isFilesystemMount(destMount);

  let strategy: FileOpStrategy;
  let destSha: string;
  let sizeBytes = sourceInfo.sizeBytes;

  if (!sourceIsFs && !destIsFs) {
    // DB -> DB: update the existing link row in place — same fileId, just a
    // new (mountPointId, relativePath). No bytes move.
    if (!sourceInfo.linkId || !sourceInfo.fileId) {
      throw new FileOpError(
        `Source file has no link row: ${sourceRel}`,
        'SOURCE_NOT_FOUND'
      );
    }
    await updateLinkLocation({
      linkId: sourceInfo.linkId,
      destMountPointId: destMount.id,
      destRelativePath: destRel,
    });
    destSha = sourceInfo.sha256;
    strategy = 'db-link';
    emitDocumentMoved({
      mountPointId: sourceMount.id,
      fromRelativePath: sourceRel,
      toRelativePath: destRel,
    });
  } else if (sourceIsFs && destIsFs) {
    const sourceAbs = sourceInfo.absolutePath!;
    const destAbs = resolveFsAbsolute(destMount, destRel);
    await fs.mkdir(path.dirname(destAbs), { recursive: true });

    let renamed = false;
    try {
      await fs.rename(sourceAbs, destAbs);
      renamed = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
      await fs.copyFile(sourceAbs, destAbs);
      await fs.unlink(sourceAbs);
    }
    // Remove source from the index, re-index the dest path.
    if (sourceInfo.linkId) {
      const repos = getRepositories();
      await repos.docMountFileLinks.deleteWithGC(sourceInfo.linkId);
    }
    await processMountFile(destMount, destAbs, destRel).catch(err => {
      logger.warn('processMountFile after fs move failed', {
        mountPointId: destMount.id,
        relativePath: destRel,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    const destBytes = await fs.readFile(destAbs);
    destSha = sha256OfBuffer(destBytes);
    sizeBytes = destBytes.length;
    strategy = renamed ? 'rename' : 'byte-copy';
  } else {
    // Cross-storage move = copy then delete source.
    const bytes = await readSourceBytes(sourceMount, sourceRel, sourceInfo);
    destSha = await writeDestBytes(destMount, destRel, bytes, sourceMount, sourceRel);
    sizeBytes = bytes.length;
    await deleteAtSource(sourceMount, sourceRel, sourceInfo);
    strategy = 'byte-copy';
  }

  if (destSha !== sourceInfo.sha256) {
    throw new FileOpError(
      `Checksum mismatch after move: source ${sourceInfo.sha256} != dest ${destSha}`,
      'VERIFY_FAILED'
    );
  }

  logger.info('Moved file', {
    sourceMountPointId: sourceMount.id,
    sourcePath: sourceRel,
    destMountPointId: destMount.id,
    destPath: destRel,
    strategy,
    sizeBytes,
  });

  return {
    strategy,
    sourceSha256: sourceInfo.sha256,
    destSha256: destSha,
    sizeBytes,
    sourcePath: sourceRel,
    destPath: destRel,
    sourceMountPointId: sourceMount.id,
    destMountPointId: destMount.id,
  };
}

// ============================================================================
// Internal writers / deleters
// ============================================================================

async function writeDestBytes(
  destMount: DocMountPoint,
  destRel: string,
  bytes: Buffer,
  sourceMount: DocMountPoint,
  sourceRel: string
): Promise<string> {
  const repos = getRepositories();
  const sha = sha256OfBuffer(bytes);
  const destFileName = path.posix.basename(destRel);

  if (isFilesystemMount(destMount)) {
    const abs = resolveFsAbsolute(destMount, destRel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, bytes);
    await processMountFile(destMount, abs, destRel).catch(err => {
      logger.warn('processMountFile after byte copy failed', {
        mountPointId: destMount.id,
        relativePath: destRel,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    return sha256OfBuffer(await fs.readFile(abs));
  }

  // Database mount: route by file type.
  const nativeText = detectNativeText(destRel);
  const folderDir = path.posix.dirname(destRel);
  const folderId = folderDir !== '.' ? await ensureFolderPath(destMount.id, folderDir) : null;

  if (nativeText) {
    const text = bytes.toString('utf-8');
    const contentSha = sha256OfString(text);
    await repos.docMountFileLinks.linkDocumentContent({
      mountPointId: destMount.id,
      relativePath: destRel,
      fileName: destFileName,
      folderId,
      fileType: nativeText,
      content: text,
      contentSha256: contentSha,
      plainTextLength: text.length,
      fileSizeBytes: Buffer.byteLength(text, 'utf-8'),
    });
    emitDocumentWritten({ mountPointId: destMount.id, relativePath: destRel });
    return contentSha;
  }

  // Binary path: linkBlobContent stores bytes verbatim in doc_mount_blobs.
  const ext = path.extname(destRel).toLowerCase();
  const fileType: DocMountFile['fileType'] =
    ext === '.pdf' ? 'pdf' : ext === '.docx' ? 'docx' : 'blob';
  const originalMime = mimeForExtension(destRel);
  await repos.docMountFileLinks.linkBlobContent({
    mountPointId: destMount.id,
    relativePath: destRel,
    fileName: destFileName,
    folderId,
    fileType,
    originalFileName: destFileName,
    originalMimeType: originalMime,
    storedMimeType: originalMime,
    sha256: sha,
    data: bytes,
  });
  emitDocumentWritten({ mountPointId: destMount.id, relativePath: destRel });
  return sha;
}

async function deleteAtSource(
  mp: DocMountPoint,
  relativePath: string,
  sourceInfo: { linkId?: string; absolutePath?: string }
): Promise<void> {
  const repos = getRepositories();
  if (isFilesystemMount(mp)) {
    if (sourceInfo.absolutePath) {
      try {
        await fs.unlink(sourceInfo.absolutePath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }
    if (sourceInfo.linkId) {
      await repos.docMountFileLinks.deleteWithGC(sourceInfo.linkId);
    }
    return;
  }
  if (sourceInfo.linkId) {
    await repos.docMountFileLinks.deleteWithGC(sourceInfo.linkId);
    emitDocumentDeleted({ mountPointId: mp.id, relativePath });
  }
}

async function deleteAtDest(mp: DocMountPoint, relativePath: string): Promise<void> {
  const repos = getRepositories();
  const link = await repos.docMountFileLinks.findByMountPointAndPath(mp.id, relativePath);
  if (link) {
    await repos.docMountFileLinks.deleteWithGC(link.id);
  }
  if (isFilesystemMount(mp)) {
    try {
      await fs.unlink(resolveFsAbsolute(mp, relativePath));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  } else {
    emitDocumentDeleted({ mountPointId: mp.id, relativePath });
  }
}

async function hardLinkDbToDb(input: {
  sourceFileId: string;
  sourceLinkId: string;
  destMountPointId: string;
  destRelativePath: string;
}): Promise<void> {
  const repos = getRepositories();
  // Pull metadata from the source link so the new link row preserves
  // originalFileName, originalMimeType, conversionStatus, etc.
  const sourceLink = await repos.docMountFileLinks.findByIdWithContent(input.sourceLinkId);
  if (!sourceLink) {
    throw new FileOpError(
      `Source link disappeared: ${input.sourceLinkId}`,
      'SOURCE_NOT_FOUND'
    );
  }
  const destFolderDir = path.posix.dirname(input.destRelativePath);
  const destFolderId =
    destFolderDir !== '.' ? await ensureFolderPath(input.destMountPointId, destFolderDir) : null;
  await insertLinkRow({
    fileId: input.sourceFileId,
    source: sourceLink.source,
    fileType: sourceLink.fileType,
    mountPointId: input.destMountPointId,
    relativePath: input.destRelativePath,
    fileName: path.posix.basename(input.destRelativePath),
    folderId: destFolderId,
    originalFileName: sourceLink.originalFileName ?? null,
    originalMimeType: sourceLink.originalMimeType ?? null,
    description: sourceLink.description ?? '',
    conversionStatus: sourceLink.conversionStatus,
    plainTextLength: sourceLink.plainTextLength ?? null,
  });
  emitDocumentWritten({
    mountPointId: input.destMountPointId,
    relativePath: input.destRelativePath,
  });
}

async function updateLinkLocation(input: {
  linkId: string;
  destMountPointId: string;
  destRelativePath: string;
}): Promise<void> {
  const repos = getRepositories();
  const destFolderDir = path.posix.dirname(input.destRelativePath);
  const destFolderId =
    destFolderDir !== '.' ? await ensureFolderPath(input.destMountPointId, destFolderDir) : null;
  await repos.docMountFileLinks.update(input.linkId, {
    mountPointId: input.destMountPointId,
    relativePath: input.destRelativePath,
    fileName: path.posix.basename(input.destRelativePath),
    folderId: destFolderId,
  });
}

// ============================================================================
// Public API: writeFile / deleteFile
// ============================================================================

export interface WriteOpts {
  mountPointId: string;
  relativePath: string;
  data: Buffer;
  force?: boolean;
}

export interface WriteResult {
  sha256: string;
  sizeBytes: number;
  destPath: string;
  mountPointId: string;
}

export async function writeFile(opts: WriteOpts): Promise<WriteResult> {
  const mp = await loadMount(opts.mountPointId);
  const rel = normaliseRelativePath(opts.relativePath);

  if (await destExists(mp, rel)) {
    if (!opts.force) {
      throw new FileOpError(
        `Destination already exists: ${rel}. Use --force to overwrite.`,
        'DEST_EXISTS'
      );
    }
    await deleteAtDest(mp, rel);
  }

  const sourceSha = sha256OfBuffer(opts.data);
  const destSha = await writeDestBytes(mp, rel, opts.data, mp, rel);
  if (destSha !== sourceSha) {
    throw new FileOpError(
      `Checksum mismatch after write: source ${sourceSha} != dest ${destSha}`,
      'VERIFY_FAILED'
    );
  }
  return {
    sha256: destSha,
    sizeBytes: opts.data.length,
    destPath: rel,
    mountPointId: mp.id,
  };
}

export interface DeleteResult {
  deleted: boolean;
  mountPointId: string;
  path: string;
}

export async function deleteFile(input: {
  mountPointId: string;
  relativePath: string;
}): Promise<DeleteResult> {
  const mp = await loadMount(input.mountPointId);
  const rel = normaliseRelativePath(input.relativePath);
  const existed = await destExists(mp, rel);
  if (!existed) {
    return { deleted: false, mountPointId: mp.id, path: rel };
  }
  await deleteAtDest(mp, rel);
  // Verify the path is actually gone.
  if (await destExists(mp, rel)) {
    throw new FileOpError(
      `Path still present after delete: ${rel}`,
      'VERIFY_FAILED'
    );
  }
  return { deleted: true, mountPointId: mp.id, path: rel };
}

// ============================================================================
// Public helpers used by the write / delete / mkdir endpoints
// ============================================================================
