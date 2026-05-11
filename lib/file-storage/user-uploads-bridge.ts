/**
 * Quilltap Uploads Store Bridge
 *
 * Holds the singleton global "Quilltap Uploads" database-backed document
 * store — the home for files produced outside of any project context:
 * chat attachments in project-less chats, pasted/drag-dropped images, the
 * shell-tool's workspace→Files copy, capabilities reports, and restored
 * backup files whose original `projectId` was null. Replaces the legacy
 * `<filesDir>/_general/` catch-all on disk.
 *
 * The mount-point id is persisted in `instance_settings.userUploadsMountPointId`
 * (provisioned by `provision-user-uploads-mount-v1`); callers should not look
 * it up by name.
 *
 * Layout inside the mount:
 *
 *   chat/<safeFilename>           — attachments uploaded into a chat with no project
 *   images/<safeFilename>         — paste/drag-drop image uploads outside a project
 *   shell/<safeFilename>          — shell-tool "copy workspace → Files" with no project
 *   diagnostics/<safeFilename>    — capabilities-report exports
 *   restored/<safeFilename>       — backup-restore replay of project-less files
 *
 * Returns the same `mount-blob:{mountPointId}:{blobId}` shim the project,
 * character, and Lantern bridges use, so existing `FileStorageManager` read /
 * delete paths resolve the bytes without change.
 *
 * @module file-storage/user-uploads-bridge
 */

import path from 'path';
import { createHash } from 'crypto';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { transcodeToWebP, normaliseBlobRelativePath } from '@/lib/mount-index/blob-transcode';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import { emitDocumentWritten } from '@/lib/mount-index/db-store-events';
import { getUserUploadsMountPointId } from '@/lib/instance-settings';
import { buildMountBlobStorageKey } from './project-store-bridge';

interface UserUploadsTarget {
  mountPointId: string;
}

export type UserUploadsSubfolder =
  | 'chat'
  | 'images'
  | 'shell'
  | 'diagnostics'
  | 'restored'
  | 'uploads';

/**
 * Look up the global Quilltap Uploads mount, if provisioned. Returns null
 * when the migration hasn't yet run or the mount row has been deleted.
 */
export async function getUserUploadsStore(): Promise<UserUploadsTarget | null> {
  try {
    const id = await getUserUploadsMountPointId();
    if (!id) return null;
    const repos = getRepositories();
    const mp = await repos.docMountPoints.findById(id);
    if (!mp) return null;
    if (mp.mountType !== 'database') return null;
    return { mountPointId: mp.id };
  } catch (error) {
    logger.warn('Failed to resolve Quilltap Uploads store', {
      context: 'file-storage.user-uploads-bridge',
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

interface WriteUserUploadInput {
  filename: string;
  content: Buffer;
  contentType: string;
  subfolder: UserUploadsSubfolder;
  description?: string;
}

interface WriteUserUploadResult {
  storageKey: string;
  mountPointId: string;
  blobId: string;
  relativePath: string;
  storedMimeType: string;
  sizeBytes: number;
  sha256: string;
}

/**
 * Write a file into the Quilltap Uploads mount. Caller must have verified
 * provisioning via `getUserUploadsStore()`; this throws otherwise. Image
 * bytes that sharp can decode are transcoded to WebP — same policy as the
 * other bridges. Non-image uploads (PDFs, text, archives) are stored as-is.
 */
export async function writeUserUploadToMountStore(
  input: WriteUserUploadInput
): Promise<WriteUserUploadResult> {
  const target = await getUserUploadsStore();
  if (!target) {
    throw new Error('Quilltap Uploads mount has not been provisioned');
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

// ============================================================================
// Internal helpers
// ============================================================================

const UNSAFE_LEAF_CHARS = /[\/\\:*?"<>|\x00-\x1f\x7f]/g;

function sanitizeLeafName(filename: string): string {
  const basename = filename.split(/[\\/]/).pop() ?? filename;
  let safe = basename.replace(UNSAFE_LEAF_CHARS, '_').replace(/_{2,}/g, '_');
  safe = safe.replace(/^[_.]+/, '').replace(/[_.]+$/, '');
  return safe || 'unnamed';
}

async function resolveUniqueRelativePath(
  mountPointId: string,
  desired: string
): Promise<string> {
  const repos = getRepositories();
  const existing = await repos.docMountBlobs.findByMountPointAndPath(mountPointId, desired);
  if (!existing) return desired;

  const dir = path.posix.dirname(desired);
  const ext = path.extname(desired);
  const stem = path.posix.basename(desired, ext);
  const prefix = dir === '.' || dir === '' ? '' : `${dir}/`;

  for (let attempt = 2; attempt <= 999; attempt++) {
    const candidate = `${prefix}${stem} (${attempt})${ext}`;
    const collision = await repos.docMountBlobs.findByMountPointAndPath(mountPointId, candidate);
    if (!collision) return candidate;
  }
  const hash = createHash('sha1').update(`${desired}:${Date.now()}`).digest('hex').slice(0, 8);
  return `${prefix}${stem}-${hash}${ext}`;
}
