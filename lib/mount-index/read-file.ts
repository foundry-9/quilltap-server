/**
 * Canonical mount-point read helpers.
 *
 * Backs the per-file REST item route's GET. Resolves a (mountPointId,
 * relativePath) to either a UTF-8 text envelope or a base64 payload, across
 * all storage shapes: filesystem mounts (bytes on disk), database documents
 * (`doc_mount_documents`), and database blobs (`doc_mount_blobs`). Binary files
 * can always be read as base64; text files default to UTF-8 with optional
 * line-window pagination (`offset`/`limit`), mirroring the `doc_read_file` tool.
 *
 * @module mount-index/read-file
 */

import path from 'path';
import { promises as fs } from 'fs';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import { sha256OfBuffer } from '@/lib/utils/sha256';
import { isTextFile } from '@/lib/doc-edit/path-resolver';
import type { DocMountFile, DocMountPoint } from '@/lib/schemas/mount-index.types';
import { FileOpError } from './file-op-error';
import { normaliseRelativePath, detectNativeText, mimeForExtension } from './path-utils';
import { resolveFsAbsolute } from './file-ops';

const logger = createServiceLogger('MountIndex:ReadFile');

export type FileEncoding = 'utf-8' | 'base64';

export interface ReadMountFileOptions {
  /** Force an encoding. Default: utf-8 for text-like files, base64 for binary. */
  encoding?: FileEncoding;
  /** Line window start (0-based), text/UTF-8 only. */
  offset?: number;
  /** Line window length, text/UTF-8 only. */
  limit?: number;
}

export interface ReadMountFileResult {
  mountPointId: string;
  relativePath: string;
  encoding: FileEncoding;
  /** UTF-8 text (possibly line-windowed) or base64 of the raw bytes. */
  content: string;
  mtime: number;
  sha256: string;
  sizeBytes: number;
  mimeType: string;
  fileType: DocMountFile['fileType'];
  /** Total line count of the full text (UTF-8 reads only). */
  totalLines?: number;
  /** True when a line window omitted trailing lines. */
  truncated?: boolean;
}

export interface MountFileBytes {
  bytes: Buffer;
  mimeType: string;
  sha256: string;
  sizeBytes: number;
  fileType: DocMountFile['fileType'];
}

function isFilesystemMount(mp: DocMountPoint): boolean {
  return mp.mountType === 'filesystem' || mp.mountType === 'obsidian';
}

function fileTypeForPath(relativePath: string): DocMountFile['fileType'] {
  const ext = path.extname(relativePath).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx') return 'docx';
  return detectNativeText(relativePath) ?? 'blob';
}

/** True when a file should default to a UTF-8 text read. */
function isTextLike(relativePath: string, fileType: DocMountFile['fileType']): boolean {
  if (fileType === 'markdown' || fileType === 'txt' || fileType === 'json' || fileType === 'jsonl') {
    return true;
  }
  if (fileType === 'pdf' || fileType === 'docx' || fileType === 'blob') return false;
  return isTextFile(relativePath);
}

async function loadMount(mountPointId: string): Promise<DocMountPoint> {
  const repos = getRepositories();
  const mp = await repos.docMountPoints.findById(mountPointId);
  if (!mp) throw new FileOpError(`Mount point not found: ${mountPointId}`, 'MOUNT_NOT_FOUND');
  return mp;
}

/**
 * Fetch the raw bytes + metadata for a mount file, regardless of storage shape.
 * Used by the `?raw=1` streaming path and as the basis for the JSON envelope.
 */
export async function readMountFileBytes(
  mountPointId: string,
  relativePath: string
): Promise<MountFileBytes> {
  const repos = getRepositories();
  const mp = await loadMount(mountPointId);
  const rel = normaliseRelativePath(relativePath);

  if (isFilesystemMount(mp)) {
    const abs = resolveFsAbsolute(mp, rel);
    try {
      const bytes = await fs.readFile(abs);
      return {
        bytes,
        mimeType: mimeForExtension(rel),
        sha256: sha256OfBuffer(bytes),
        sizeBytes: bytes.length,
        fileType: fileTypeForPath(rel),
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new FileOpError(`File not found: ${rel}`, 'SOURCE_NOT_FOUND');
      }
      throw err;
    }
  }

  // Database mount: documents (text) live in doc_mount_documents, everything
  // else in doc_mount_blobs. The link row tells us which.
  const link = await repos.docMountFileLinks.findByMountPointAndPath(mp.id, rel);
  if (!link) throw new FileOpError(`File not found: ${rel}`, 'SOURCE_NOT_FOUND');

  if (link.fileType === 'markdown' || link.fileType === 'txt' || link.fileType === 'json' || link.fileType === 'jsonl') {
    const doc = await repos.docMountDocuments.findByMountPointAndPath(mp.id, rel);
    if (!doc) throw new FileOpError(`Document content missing: ${rel}`, 'SOURCE_NOT_FOUND');
    const bytes = Buffer.from(doc.content, 'utf-8');
    return {
      bytes,
      mimeType: mimeForExtension(rel),
      sha256: doc.contentSha256,
      sizeBytes: bytes.length,
      fileType: link.fileType,
    };
  }

  const bytes = await repos.docMountBlobs.readDataByFileId(link.fileId);
  if (!bytes) throw new FileOpError(`Blob content missing: ${rel}`, 'SOURCE_NOT_FOUND');
  const meta = await repos.docMountBlobs.findByMountPointAndPath(mp.id, rel);
  return {
    bytes,
    mimeType: meta?.storedMimeType ?? mimeForExtension(rel),
    sha256: meta?.sha256 ?? sha256OfBuffer(bytes),
    sizeBytes: meta?.sizeBytes ?? bytes.length,
    fileType: link.fileType,
  };
}

/**
 * Read a mount file into a JSON-friendly envelope. Text files come back as
 * UTF-8 (optionally line-windowed); binary files come back as base64. The
 * caller may force `encoding`.
 */
export async function readMountFile(
  mountPointId: string,
  relativePath: string,
  options: ReadMountFileOptions = {}
): Promise<ReadMountFileResult> {
  const repos = getRepositories();
  const mp = await loadMount(mountPointId);
  const rel = normaliseRelativePath(relativePath);

  const raw = await readMountFileBytes(mp.id, rel);

  // mtime: filesystem stat, document lastModified, or blob link lastModified.
  let mtime = Date.now();
  if (isFilesystemMount(mp)) {
    try {
      const stat = await fs.stat(resolveFsAbsolute(mp, rel));
      mtime = stat.mtime.getTime();
    } catch { /* fall back to now */ }
  } else {
    const link = await repos.docMountFileLinks.findByMountPointAndPath(mp.id, rel);
    if (link?.lastModified) mtime = new Date(link.lastModified).getTime();
  }

  const wantsText =
    options.encoding === 'utf-8' ||
    (options.encoding === undefined && isTextLike(rel, raw.fileType));

  if (!wantsText) {
    logger.debug('readMountFile: base64 read', { mountPointId: mp.id, relativePath: rel, sizeBytes: raw.sizeBytes });
    return {
      mountPointId: mp.id,
      relativePath: rel,
      encoding: 'base64',
      content: raw.bytes.toString('base64'),
      mtime,
      sha256: raw.sha256,
      sizeBytes: raw.sizeBytes,
      mimeType: raw.mimeType,
      fileType: raw.fileType,
    };
  }

  const fullText = raw.bytes.toString('utf-8');
  const allLines = fullText.split('\n');
  const totalLines = allLines.length;

  let content = fullText;
  let truncated = false;
  if (options.offset !== undefined || options.limit !== undefined) {
    const start = options.offset ?? 0;
    const end = options.limit !== undefined ? start + options.limit : totalLines;
    const window = allLines.slice(start, end);
    content = window.join('\n');
    truncated = end < totalLines;
  }

  logger.debug('readMountFile: utf-8 read', {
    mountPointId: mp.id, relativePath: rel, totalLines, truncated,
  });

  return {
    mountPointId: mp.id,
    relativePath: rel,
    encoding: 'utf-8',
    content,
    mtime,
    sha256: raw.sha256,
    sizeBytes: raw.sizeBytes,
    mimeType: raw.mimeType,
    fileType: raw.fileType,
    totalLines,
    truncated,
  };
}
