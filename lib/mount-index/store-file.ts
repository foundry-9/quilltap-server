/**
 * Canonical mount-point write/ingest pipeline.
 *
 * `storeMountFile()` is the single chokepoint every *fresh* file write funnels
 * through — the per-file REST item route (`PUT`), the blob upload route, and
 * the four file-storage bridges (project / user-uploads / Lantern / character
 * vault). It unifies what used to be duplicated four-plus times:
 *
 *   - native-text vs binary routing,
 *   - image transcode to WebP,
 *   - PDF/DOCX text extraction + chunk/embedding enqueue,
 *   - content-addressed dedup (by sha256) and folder-row ensure,
 *   - mtime-based optimistic concurrency (text path),
 *   - the `emitDocumentWritten` store event.
 *
 * It is deliberately distinct from `file-ops.copyFile`/`moveFile`, which are
 * *byte-preserving* (they must not transcode, so their sha verification holds).
 * Fresh writes ingest; copy/move relocate. See `docs/developer/API.md`.
 *
 * Runs in the parent (DB-writer) process only: the REST routes are parent-side,
 * and the bridges bounce to the host before calling in here when invoked from a
 * background-job child. A defensive guard logs if that invariant is violated.
 *
 * @module mount-index/store-file
 */

import path from 'path';
import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import { sha256OfBuffer } from '@/lib/utils/sha256';
import type { DocMountFile, DocMountPoint } from '@/lib/schemas/mount-index.types';
import { FileOpError } from './file-op-error';
import { normaliseRelativePath, detectNativeText, mimeForExtension } from './path-utils';
import { destExists, deleteAtDest, writeFsFileBytes, resolveFsAbsolute } from './file-ops';
import { transcodeToWebP, normaliseBlobRelativePath } from './blob-transcode';
import { convertBufferToPlainText } from './converters';
import { ensureFolderPath } from './folder-paths';
import { emitDocumentWritten } from './db-store-events';
import { writeDatabaseDocument, databaseDocumentExists } from './database-store';
import { reindexSingleFile } from '@/lib/doc-edit/reindex-file';
import { enqueueEmbeddingJobsForMountPoint } from './embedding-scheduler';
import { resolveUniqueRelativePath } from '@/lib/file-storage/bridge-path-helpers';

const logger = createServiceLogger('MountIndex:StoreFile');

/**
 * Collision policy when the destination path is already occupied.
 *  - `error-if-exists`: throw `DEST_EXISTS` unless `force` (then overwrite).
 *  - `overwrite`: upsert in place; rely on `expectedMtime` for conflict detection.
 *  - `unique-suffix`: pick a free ` (2)`, ` (3)`… path (bridges/attachments).
 */
export type CollisionStrategy = 'error-if-exists' | 'overwrite' | 'unique-suffix';

/**
 * Where binary bytes land.
 *  - `auto`: mount-type aware — filesystem/obsidian mounts write to disk,
 *    database mounts write to `doc_mount_blobs` (or `doc_mount_documents` for
 *    native text). This is the canonical behaviour for the REST item route.
 *  - `database`: always store in the mount-index DB even on filesystem mounts.
 *    Preserves the legacy `/blobs` upload behaviour (and keeps the persisted
 *    `<img src=".../blobs/<path>">` URLs resolvable for filesystem mounts).
 */
export type AssetStorageMode = 'auto' | 'database';

export interface StoreFileInput {
  mountPointId: string;
  /** Caller-chosen virtual/relative path (e.g. `notes/intro.md`). */
  relativePath: string;
  /** Raw bytes — any transport encoding (base64 etc.) already decoded. */
  data: Buffer;
  originalMimeType?: string;
  originalFileName?: string;
  description?: string;
  /** Overwrite an existing destination (for `error-if-exists`). */
  force?: boolean;
  /** Optimistic-concurrency guard for the native-text document path. */
  expectedMtime?: number;
  /** Transcode bitmap images to WebP (default true). */
  transcodeImages?: boolean;
  /** Extract text from PDF/DOCX and enqueue chunks (default true). */
  extractText?: boolean;
  /** Enqueue embedding jobs after a text write (default true). */
  enqueueEmbedding?: boolean;
  /** Route native-text into `doc_mount_documents` (default true). Bridges set
   *  false so chat attachments etc. stay binary blobs with a storageKey. */
  treatNativeTextAsDocument?: boolean;
  collisionStrategy?: CollisionStrategy;
  assetStorage?: AssetStorageMode;
}

export interface StoreFileResult {
  mountPointId: string;
  /** The path actually written (may differ from the input after transcode
   *  extension rewrite or a `unique-suffix` collision bump). */
  relativePath: string;
  /** How the bytes were stored. */
  kind: 'document' | 'blob' | 'filesystem';
  fileType: DocMountFile['fileType'];
  sha256: string;
  sizeBytes: number;
  storedMimeType: string;
  mtime: number;
  /** Present for database mounts (document + blob paths). */
  fileId?: string;
  linkId?: string;
  /** Present for the blob path; callers build their own storageKey from it. */
  blobId?: string;
}

function isFilesystemMount(mp: DocMountPoint): boolean {
  return mp.mountType === 'filesystem' || mp.mountType === 'obsidian';
}

function detectBlobFileType(relativePath: string): 'pdf' | 'docx' | 'blob' {
  const ext = path.extname(relativePath).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx') return 'docx';
  return 'blob';
}

/**
 * Store a freshly-supplied file into a mount point, ingesting it the same way
 * regardless of which surface (REST / bridge / CLI) called in.
 */
export async function storeMountFile(input: StoreFileInput): Promise<StoreFileResult> {
  if (process.env.QUILLTAP_JOB_CHILD === '1') {
    // Raw mount-index DB writes (linkBlobContent etc.) bypass the child's
    // buffered repo proxy, so they must run in the parent. Bridges bounce to
    // the host before reaching here; if we ever see a child context it's a
    // wiring bug worth surfacing rather than silently corrupting state.
    logger.warn('storeMountFile invoked inside a background-job child — bytes may not persist', {
      mountPointId: input.mountPointId,
      relativePath: input.relativePath,
    });
  }

  const repos = getRepositories();
  const mp = await repos.docMountPoints.findById(input.mountPointId);
  if (!mp) {
    throw new FileOpError(`Mount point not found: ${input.mountPointId}`, 'MOUNT_NOT_FOUND');
  }

  const rel = normaliseRelativePath(input.relativePath);
  const strategy: CollisionStrategy = input.collisionStrategy ?? 'error-if-exists';
  const assetStorage: AssetStorageMode = input.assetStorage ?? 'auto';
  const transcodeImages = input.transcodeImages ?? true;
  const extractText = input.extractText ?? true;
  const enqueueEmbedding = input.enqueueEmbedding ?? true;
  const treatNativeTextAsDocument = input.treatNativeTextAsDocument ?? true;

  // ---------------------------------------------------------------------------
  // Filesystem mounts (auto storage): bytes go to disk, indexed by the scanner.
  // ---------------------------------------------------------------------------
  if (assetStorage === 'auto' && isFilesystemMount(mp)) {
    // Optimistic concurrency: reject when the on-disk file changed under us.
    if (input.expectedMtime !== undefined) {
      try {
        const abs = resolveFsAbsolute(mp, rel);
        const stat = await fs.stat(abs);
        if (stat.mtime.getTime() !== input.expectedMtime) {
          throw new FileOpError(
            `File was modified by another process (mtime mismatch). Reload and try again.`,
            'CONFLICT'
          );
        }
      } catch (err) {
        // ENOENT is fine — the file doesn't exist yet, so there's no conflict.
        if (err instanceof FileOpError) throw err;
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }
    if (strategy === 'error-if-exists' && (await destExists(mp, rel))) {
      if (!input.force) {
        throw new FileOpError(`Destination already exists: ${rel}. Use force to overwrite.`, 'DEST_EXISTS');
      }
      await deleteAtDest(mp, rel);
    }
    const fsResult = await writeFsFileBytes(mp, rel, input.data);
    const link = await repos.docMountFileLinks.findByMountPointAndPath(mp.id, rel);
    return {
      mountPointId: mp.id,
      relativePath: rel,
      kind: 'filesystem',
      // If processMountFile failed to index (no link row), still report a
      // sensible type: native text by extension before the binary fallback,
      // so a freshly-written .md/.txt isn't mislabelled as 'blob'.
      fileType: link?.fileType ?? detectNativeText(rel) ?? detectBlobFileType(rel),
      sha256: fsResult.sha256,
      sizeBytes: fsResult.sizeBytes,
      storedMimeType: input.originalMimeType || mimeForExtension(rel),
      mtime: fsResult.mtime,
      fileId: link?.fileId,
      linkId: link?.id,
    };
  }

  // ---------------------------------------------------------------------------
  // Database storage — native-text documents.
  // ---------------------------------------------------------------------------
  const nativeText = detectNativeText(rel);
  if (treatNativeTextAsDocument && nativeText && mp.mountType === 'database') {
    if (strategy === 'error-if-exists' && (await databaseDocumentExists(mp.id, rel)) && !input.force) {
      throw new FileOpError(`Destination already exists: ${rel}. Use force to overwrite.`, 'DEST_EXISTS');
    }
    const text = input.data.toString('utf-8');
    // writeDatabaseDocument upserts + enforces the expectedMtime check (throws
    // DatabaseStoreError 'CONFLICT' → 409 via fileOpStatus) and emits the event.
    const { mtime } = await writeDatabaseDocument(mp.id, rel, text, input.expectedMtime);

    if (enqueueEmbedding) {
      // Fire-and-forget chunk + embedding enqueue (matches the doc-edit handler).
      reindexSingleFile(mp.id, rel, '')
        .then(() => Promise.all([
          enqueueEmbeddingJobsForMountPoint(mp.id),
          repos.docMountPoints.refreshStats(mp.id),
        ]))
        .catch(err => {
          logger.warn('storeMountFile: background reindex failed for native-text write', {
            mountPointId: mp.id,
            relativePath: rel,
            error: err instanceof Error ? err.message : String(err),
          });
        });
    } else {
      repos.docMountPoints.refreshStats(mp.id).catch(() => { /* best-effort */ });
    }

    const link = await repos.docMountFileLinks.findByMountPointAndPath(mp.id, rel);
    const sizeBytes = Buffer.byteLength(text, 'utf-8');
    return {
      mountPointId: mp.id,
      relativePath: rel,
      kind: 'document',
      fileType: nativeText,
      sha256: link?.sha256 ?? createHash('sha256').update(text, 'utf-8').digest('hex'),
      sizeBytes,
      storedMimeType: mimeForExtension(rel),
      mtime,
      fileId: link?.fileId,
      linkId: link?.id,
    };
  }

  // ---------------------------------------------------------------------------
  // Database storage — binary/blob mirror (with optional transcode + extract).
  // ---------------------------------------------------------------------------
  const originalMimeType = input.originalMimeType || mimeForExtension(rel);
  const transcoded = transcodeImages
    ? await transcodeToWebP(input.data, originalMimeType)
    : {
        data: input.data,
        storedMimeType: originalMimeType,
        sizeBytes: input.data.length,
        sha256: sha256OfBuffer(input.data),
      };

  let finalPath = normaliseBlobRelativePath(rel, transcoded.storedMimeType);

  if (strategy === 'unique-suffix') {
    finalPath = await resolveUniqueRelativePath(mp.id, finalPath);
  } else if (strategy === 'error-if-exists' && (await destExists(mp, finalPath))) {
    if (!input.force) {
      throw new FileOpError(`Destination already exists: ${finalPath}. Use force to overwrite.`, 'DEST_EXISTS');
    }
    await deleteAtDest(mp, finalPath);
  }

  const folderDir = path.posix.dirname(finalPath);
  const folderId = folderDir !== '.' && folderDir !== '' ? await ensureFolderPath(mp.id, folderDir) : null;
  const mirrorFileType = detectBlobFileType(finalPath);

  // 'overwrite' (and force) re-point an existing link at new content — drop its
  // stale chunks first so a re-extraction starts clean.
  const existingLink = await repos.docMountFileLinks.findByMountPointAndPath(mp.id, finalPath);
  if (existingLink) {
    await repos.docMountChunks.deleteByLinkId(existingLink.id);
  }

  const { link, file, blobId } = await repos.docMountFileLinks.linkBlobContent({
    mountPointId: mp.id,
    relativePath: finalPath,
    fileName: path.posix.basename(finalPath),
    folderId,
    fileType: mirrorFileType,
    originalFileName: input.originalFileName ?? path.posix.basename(finalPath),
    originalMimeType,
    storedMimeType: transcoded.storedMimeType,
    sha256: transcoded.sha256,
    description: input.description ?? '',
    data: transcoded.data,
  });

  // PDF/DOCX: extract plain text from the ORIGINAL bytes (transcode only
  // touches bitmaps, so for these types transcoded.data === input.data).
  let hasExtractedText = false;
  if (extractText && (mirrorFileType === 'pdf' || mirrorFileType === 'docx')) {
    try {
      const text = await convertBufferToPlainText(input.data, mirrorFileType);
      if (text && text.trim().length > 0) {
        const sha = createHash('sha256').update(text, 'utf-8').digest('hex');
        await repos.docMountBlobs.updateExtractedText(blobId, {
          extractedText: text,
          extractedTextSha256: sha,
          extractionStatus: 'converted',
          extractionError: null,
        }, link.id);
        hasExtractedText = true;
        await repos.docMountFileLinks.update(link.id, {
          conversionStatus: 'converted',
          conversionError: null,
          plainTextLength: text.length,
          chunkCount: 0,
        });
      } else {
        await repos.docMountBlobs.updateExtractedText(blobId, {
          extractedText: null,
          extractedTextSha256: null,
          extractionStatus: 'failed',
          extractionError: 'Converter produced no text',
        }, link.id);
        await repos.docMountFileLinks.update(link.id, {
          conversionStatus: 'skipped',
          conversionError: 'Converter produced no text',
          plainTextLength: null,
          chunkCount: 0,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('storeMountFile: text extraction failed', {
        mountPointId: mp.id,
        relativePath: finalPath,
        fileType: mirrorFileType,
        error: msg,
      });
      await repos.docMountBlobs.updateExtractedText(blobId, {
        extractedText: null,
        extractedTextSha256: null,
        extractionStatus: 'failed',
        extractionError: msg,
      }, link.id);
      await repos.docMountFileLinks.update(link.id, {
        conversionStatus: 'skipped',
        conversionError: msg,
        plainTextLength: null,
        chunkCount: 0,
      });
    }
  }

  emitDocumentWritten({ mountPointId: mp.id, relativePath: finalPath });

  if (enqueueEmbedding && hasExtractedText) {
    reindexSingleFile(mp.id, finalPath, '')
      .then(() => Promise.all([
        enqueueEmbeddingJobsForMountPoint(mp.id),
        repos.docMountPoints.refreshStats(mp.id),
      ]))
      .catch(err => {
        logger.warn('storeMountFile: background reindex failed for blob', {
          mountPointId: mp.id,
          relativePath: finalPath,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  } else {
    repos.docMountPoints.refreshStats(mp.id).catch(() => { /* best-effort */ });
  }

  return {
    mountPointId: mp.id,
    relativePath: finalPath,
    kind: 'blob',
    fileType: mirrorFileType,
    sha256: transcoded.sha256,
    sizeBytes: transcoded.sizeBytes,
    storedMimeType: transcoded.storedMimeType,
    mtime: Date.now(),
    fileId: file.id,
    linkId: link.id,
    blobId,
  };
}
