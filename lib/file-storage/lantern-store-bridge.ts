/**
 * Lantern Backgrounds Store Bridge
 *
 * Holds the singleton global "Lantern Backgrounds" database-backed document
 * store — the home for generated story backgrounds and ad-hoc image-tool
 * output when there's no project context to land them in. The mount-point id
 * is persisted in `instance_settings.lanternBackgroundsMountPointId` (provisioned
 * by `provision-lantern-backgrounds-mount-v1`); callers should not look it up
 * via name.
 *
 * Layout inside the mount:
 *
 *   generated/<safeFilename>   — story-background job output
 *   tool/<safeFilename>        — generic `generate_image` tool output, plus
 *                                the `/api/v1/images?action=generate` route
 *
 * Returns the same `mount-blob:{mountPointId}:{blobId}` shim the project and
 * character bridges use, so existing `FileStorageManager` read/delete paths
 * resolve the bytes without change.
 *
 * @module file-storage/lantern-store-bridge
 */

import path from 'path';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { transcodeToWebP, normaliseBlobRelativePath } from '@/lib/mount-index/blob-transcode';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import { emitDocumentWritten } from '@/lib/mount-index/db-store-events';
import { getLanternBackgroundsMountPointId } from '@/lib/instance-settings';
import { buildMountBlobStorageKey } from './project-store-bridge';
import { sanitizeLeafName, resolveUniqueRelativePath } from './bridge-path-helpers';

interface LanternStoreTarget {
  mountPointId: string;
}

/**
 * Look up the global Lantern Backgrounds mount, if provisioned. Returns null
 * when the migration hasn't yet run or the mount row has been deleted.
 */
export async function getLanternBackgroundsStore(): Promise<LanternStoreTarget | null> {
  try {
    const id = await getLanternBackgroundsMountPointId();
    if (!id) return null;
    const repos = getRepositories();
    const mp = await repos.docMountPoints.findById(id);
    if (!mp) return null;
    if (mp.mountType !== 'database') return null;
    return { mountPointId: mp.id };
  } catch (error) {
    logger.warn('Failed to resolve Lantern Backgrounds store', {
      context: 'file-storage.lantern-store-bridge',
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

interface WriteLanternBackgroundInput {
  filename: string;
  content: Buffer;
  contentType: string;
  /** Top-level folder inside the mount. */
  subfolder: 'generated' | 'tool';
  description?: string;
}

interface WriteLanternBackgroundResult {
  storageKey: string;
  mountPointId: string;
  blobId: string;
  relativePath: string;
  storedMimeType: string;
  sizeBytes: number;
  sha256: string;
}

/**
 * Write a generated image into the Lantern Backgrounds mount. Caller must
 * have verified provisioning via `getLanternBackgroundsStore()`; this throws
 * otherwise. Image bytes that sharp can decode are transcoded to WebP.
 */
export async function writeLanternBackgroundToMountStore(
  input: WriteLanternBackgroundInput
): Promise<WriteLanternBackgroundResult> {
  const target = await getLanternBackgroundsStore();
  if (!target) {
    throw new Error('Lantern Backgrounds mount has not been provisioned');
  }

  const repos = getRepositories();
  const safeName = sanitizeLeafName(input.filename);
  const transcoded = await transcodeToWebP(input.content, input.contentType);
  const desiredPath = `${input.subfolder}/${safeName}`;
  const basePath = normaliseBlobRelativePath(desiredPath, transcoded.storedMimeType);
  const relativePath = await resolveUniqueRelativePath(target.mountPointId, basePath);

  const folderId = await ensureFolderPath(target.mountPointId, input.subfolder);

  const blob = await repos.docMountBlobs.create({
    mountPointId: target.mountPointId,
    relativePath,
    originalFileName: safeName,
    originalMimeType: input.contentType,
    storedMimeType: transcoded.storedMimeType,
    sha256: transcoded.sha256,
    description: input.description ?? '',
    data: transcoded.data,
  });

  const now = new Date().toISOString();
  await repos.docMountFiles.create({
    mountPointId: target.mountPointId,
    relativePath,
    fileName: path.posix.basename(relativePath),
    fileType: 'blob',
    sha256: blob.sha256,
    fileSizeBytes: blob.sizeBytes,
    lastModified: now,
    source: 'database',
    folderId,
    conversionStatus: 'skipped',
    conversionError: null,
    plainTextLength: null,
    chunkCount: 0,
  });

  emitDocumentWritten({ mountPointId: target.mountPointId, relativePath });
  repos.docMountPoints.refreshStats(target.mountPointId).catch(() => { /* best-effort */ });

  return {
    storageKey: buildMountBlobStorageKey(target.mountPointId, blob.id),
    mountPointId: target.mountPointId,
    blobId: blob.id,
    relativePath,
    storedMimeType: blob.storedMimeType,
    sizeBytes: blob.sizeBytes,
    sha256: blob.sha256,
  };
}

