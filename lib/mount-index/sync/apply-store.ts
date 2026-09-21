/**
 * The store half of the applier.
 *
 * Every write here goes through an existing chokepoint — `linkDocumentContent`
 * / `linkBlobContent`, `ensureFolderPath`, `deleteDatabaseFolder`,
 * `deleteWithGC`, `updateDescription` — and the sync issues no SQL of its own.
 * That is what buys it the store's own post-write behaviour for free: folder
 * rows, hard-link fan-out, the re-chunk pass, and the debounced embedding
 * scheduler all run exactly as they do for any other write, because they *are*
 * the same write.
 *
 * Two deliberate departures from a Scriptorium upload:
 *
 *   - **No transcoding.** `storeMountFile` turns a bitmap into WebP and renames
 *     it; a `.png` pushed from disk must stay a `.png` with the same sha, or
 *     the two sides never converge. The blob route serves `storedMimeType` as
 *     it finds it and the LLM transport shrinker decodes anything `sharp` can,
 *     so nothing downstream minds.
 *   - **No opinion about metadata.** A byte write passes no `description` /
 *     `extractedText`, which since bug 155 means "keep what is there" rather
 *     than "blank it".
 *
 * Every content write is compare-and-swap against the sha the planner saw, so
 * a change that landed mid-run is reported rather than overwritten.
 *
 * @module mount-index/sync/apply-store
 */

import path from 'path';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { sha256OfBuffer, sha256OfString } from '@/lib/utils/sha256';
import { detectNativeText, mimeForExtension } from '@/lib/mount-index/path-utils';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import { deleteDatabaseFolder } from '@/lib/mount-index/database-store';
import { reindexAfterDatabaseWrite } from '@/lib/mount-index/post-write-reindex';
import { emitDocumentWritten } from '@/lib/mount-index/db-store-events';
import type { DocMountFile } from '@/lib/schemas/mount-index.types';
import type { SyncAction } from './types';

/** A store-side write whose target moved under the planner's feet. */
export class StoreRaceError extends Error {
  constructor(relativePath: string, expected: string | undefined, found: string | undefined) {
    super(
      `${relativePath} changed in the store while the sync was running ` +
      `(expected sha ${expected?.slice(0, 12) ?? 'none'}…, found ${found?.slice(0, 12) ?? 'none'}…)`
    );
    this.name = 'StoreRaceError';
  }
}

/**
 * Confirm the store still holds what the planner saw.
 *
 * `expected` being undefined means the planner saw nothing at this path, so
 * anything there now is a race too.
 */
async function assertUnchanged(
  mountPointId: string,
  relativePath: string,
  expected: string | undefined
): Promise<void> {
  const repos = getRepositories();
  const current = await repos.docMountFileLinks.findByMountPointAndPath(mountPointId, relativePath);
  const found = current?.sha256;
  if (found !== expected) throw new StoreRaceError(relativePath, expected, found);
}

/** Write bytes into the store verbatim, text or binary, and re-chunk. */
export async function writeStoreFile(
  mountPointId: string,
  relativePath: string,
  bytes: Buffer,
  times: { lastModified?: string; createdAt?: string | null }
): Promise<string> {
  const repos = getRepositories();
  const fileName = path.posix.basename(relativePath);
  const folderDir = path.posix.dirname(relativePath);
  const folderId = folderDir !== '.' ? await ensureFolderPath(mountPointId, folderDir) : null;
  const createdAt = times.createdAt ?? undefined;

  const nativeText = detectNativeText(relativePath);
  if (nativeText) {
    const content = bytes.toString('utf-8');
    const contentSha256 = sha256OfString(content);
    await repos.docMountFileLinks.linkDocumentContent({
      mountPointId,
      relativePath,
      fileName,
      folderId,
      fileType: nativeText,
      content,
      contentSha256,
      plainTextLength: content.length,
      fileSizeBytes: Buffer.byteLength(content, 'utf-8'),
      lastModified: times.lastModified,
      createdAt,
    });
    await reindexAfterDatabaseWrite(mountPointId, relativePath);
    emitDocumentWritten({ mountPointId, relativePath });
    return contentSha256;
  }

  const ext = path.extname(relativePath).toLowerCase();
  const fileType: DocMountFile['fileType'] =
    ext === '.pdf' ? 'pdf' : ext === '.docx' ? 'docx' : 'blob';
  const mime = mimeForExtension(relativePath);

  // No description / extractedText / extractionStatus: the sync has no opinion
  // about the caption it is writing bytes underneath, and since bug 155 an
  // omitted field on the update branch keeps what the store already holds.
  await repos.docMountFileLinks.linkBlobContent({
    mountPointId,
    relativePath,
    fileName,
    folderId,
    fileType,
    originalFileName: fileName,
    originalMimeType: mime,
    storedMimeType: mime,
    sha256: sha256OfBuffer(bytes),  // advisory; the writer recomputes and is authoritative
    data: bytes,
    lastModified: times.lastModified,
    createdAt,
  });
  emitDocumentWritten({ mountPointId, relativePath });

  // pdf/docx carry extractable text, so they chunk like a document does.
  if (fileType !== 'blob') {
    await reindexAfterDatabaseWrite(mountPointId, relativePath);
  }

  const written = await repos.docMountFileLinks.findByMountPointAndPath(mountPointId, relativePath);
  return written?.sha256 ?? '';
}

/** Read a store file's bytes back out — text from documents, binaries from blobs. */
export async function readStoreBytes(
  mountPointId: string,
  relativePath: string
): Promise<Buffer | null> {
  const repos = getRepositories();
  const link = await repos.docMountFileLinks.findByMountPointAndPath(mountPointId, relativePath);
  if (!link) return null;

  const doc = await repos.docMountDocuments.findByFileId(link.fileId);
  if (doc) return Buffer.from(doc.content, 'utf-8');

  const bytes = await repos.docMountBlobs.readDataByFileId(link.fileId);
  return bytes ?? null;
}

/**
 * Apply one store-side action.
 *
 * Returns the bytes the action wrote, when it wrote any, so the engine can
 * reuse them for the manifest without a second read.
 */
export async function applyStoreAction(
  mountPointId: string,
  action: SyncAction,
  bytes: Buffer | null
): Promise<void> {
  const repos = getRepositories();

  switch (action.kind) {
    case 'mkdir':
      await ensureFolderPath(mountPointId, action.relativePath);
      return;

    case 'create':
    case 'modify': {
      if (!bytes) throw new Error(`No bytes supplied for ${action.kind} ${action.relativePath}`);
      await assertUnchanged(mountPointId, action.relativePath, action.expectedStoreSha256);
      await writeStoreFile(mountPointId, action.relativePath, bytes, action);
      return;
    }

    case 'touch': {
      if (!action.linkId) throw new Error(`No link to touch at ${action.relativePath}`);
      await repos.docMountFileLinks.setLinkTimestamps(action.linkId, {
        lastModified: action.lastModified,
        createdAt: action.createdAt ?? undefined,
      });
      return;
    }

    case 'describe': {
      // A caption for a file this same run has just adopted has no link id yet
      // — the planner could not know one — so resolve by path when it is absent.
      const link = action.linkId
        ? await repos.docMountFileLinks.findById(action.linkId)
        : await repos.docMountFileLinks.findByMountPointAndPath(mountPointId, action.relativePath);
      if (!link) throw new Error(`No link to describe at ${action.relativePath}`);
      // The three-arg form: the two-arg one picks an arbitrary link off the
      // file row, which for a hard-linked image is the wrong location's caption.
      await repos.docMountBlobs.updateDescription(
        await blobIdFor(link.fileId, action.relativePath),
        action.description ?? '',
        link.id
      );
      return;
    }

    case 'delete': {
      if (!action.linkId) throw new Error(`No link to delete at ${action.relativePath}`);
      await repos.docMountFileLinks.deleteWithGC(action.linkId);
      return;
    }

    case 'rmdir':
      // Refuses a non-empty folder; the planner has already ordered this
      // after every file deletion beneath it.
      await deleteDatabaseFolder(mountPointId, action.relativePath);
      return;

    default:
      logger.debug('[Sync] Store applier ignoring action', { kind: action.kind });
  }
}

async function blobIdFor(fileId: string, relativePath: string): Promise<string> {
  const repos = getRepositories();
  const blob = await repos.docMountBlobs.findByFileId(fileId);
  if (!blob) throw new Error(`No blob row behind ${relativePath}; cannot set its description`);
  return blob.id;
}
