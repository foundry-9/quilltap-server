/**
 * Project Document Store Bridge
 *
 * When a project has a linked database-backed Scriptorium mount point
 * (established in the Stage 1 migration), writes that would normally land at
 * <filesDir>/{projectId}/... are redirected into that mount point's blob
 * table. The file's storageKey is recorded as:
 *
 *   mount-blob:{mountPointId}:{blobId}
 *
 * so downstream read / delete / exists paths can tell the two storage modes
 * apart. This is Stage 2 of the consolidation — Stage 1 migrated historical
 * bytes; Stage 2 stops new ones from hitting disk in the first place.
 *
 * Only database-backed mount points participate. Filesystem / obsidian stores
 * are ignored — those already manage their own disk layout and a redirect
 * would be a step sideways rather than forward.
 *
 * @module file-storage/project-store-bridge
 */

import path from 'path';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { transcodeToWebP, normaliseBlobRelativePath } from '@/lib/mount-index/blob-transcode';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import { emitDocumentWritten } from '@/lib/mount-index/db-store-events';
import { pickPrimaryProjectStore } from '@/lib/mount-index/project-store-naming';
import type { DocMountPoint } from '@/lib/schemas/mount-index.types';
import {
  UNSAFE_LEAF_CHARS,
  sanitizeLeafName,
  resolveUniqueRelativePath,
} from './bridge-path-helpers';

const STORAGE_KEY_PREFIX = 'mount-blob:';

interface ProjectStoreTarget {
  mountPointId: string;
  mountPointName: string;
}

/**
 * Look up the database-backed document store linked to a project, if any.
 * Returns null when the project has no link, when the link points at a
 * filesystem / obsidian store, or when the mount index DB is unavailable.
 */
export async function getProjectDocumentStore(
  projectId: string | null | undefined
): Promise<ProjectStoreTarget | null> {
  if (!projectId) return null;

  try {
    const repos = getRepositories();
    const links = await repos.projectDocMountLinks.findByProjectId(projectId);
    if (!links.length) return null;

    const mountPoints: DocMountPoint[] = [];
    for (const link of links) {
      const mp = await repos.docMountPoints.findById(link.mountPointId);
      if (mp) mountPoints.push(mp);
    }

    const chosen = pickPrimaryProjectStore(mountPoints);
    if (!chosen) return null;
    return { mountPointId: chosen.id, mountPointName: chosen.name };
  } catch (error) {
    return null;
  }
}

/**
 * True when the storageKey refers to a blob in a database-backed mount point.
 */
export function isMountBlobStorageKey(storageKey: string | null | undefined): boolean {
  return typeof storageKey === 'string' && storageKey.startsWith(STORAGE_KEY_PREFIX);
}

/**
 * Parse a mount-blob storageKey into its components. Returns null for keys
 * that don't match the scheme, so callers can use the result as a type guard.
 */
export function parseMountBlobStorageKey(
  storageKey: string
): { mountPointId: string; blobId: string } | null {
  if (!isMountBlobStorageKey(storageKey)) return null;
  const rest = storageKey.slice(STORAGE_KEY_PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep < 1 || sep === rest.length - 1) return null;
  return {
    mountPointId: rest.slice(0, sep),
    blobId: rest.slice(sep + 1),
  };
}

/**
 * Build a storage key for a freshly-written mount blob.
 */
export function buildMountBlobStorageKey(mountPointId: string, blobId: string): string {
  return `${STORAGE_KEY_PREFIX}${mountPointId}:${blobId}`;
}

interface WriteProjectFileInput {
  projectId: string;
  filename: string;
  content: Buffer;
  contentType: string;
  folderPath?: string;
  description?: string;
}

interface WriteProjectFileResult {
  storageKey: string;
  mountPointId: string;
  blobId: string;
  relativePath: string;
  storedMimeType: string;
  sizeBytes: number;
  sha256: string;
}

/**
 * Write a file into the project's linked database-backed mount point.
 *
 * Bitmap images are transcoded to WebP (matching the HTTP blob upload path);
 * other MIME types are stored as-is. A doc_mount_files mirror row is created
 * so the Scriptorium UI lists the file in the project's store.
 *
 * Throws if the project has no linked database-backed store — callers should
 * check getProjectDocumentStore() first when a disk fallback is desired.
 */
export async function writeProjectFileToMountStore(
  input: WriteProjectFileInput
): Promise<WriteProjectFileResult> {
  const target = await getProjectDocumentStore(input.projectId);
  if (!target) {
    throw new Error(
      `Project ${input.projectId} has no linked database-backed document store`
    );
  }

  const repos = getRepositories();
  const safeName = sanitizeLeafName(input.filename);
  const folderDir = normaliseFolderDir(input.folderPath);

  const transcoded = await transcodeToWebP(input.content, input.contentType);
  const desiredPath = folderDir ? `${folderDir}/${safeName}` : safeName;
  const basePath = normaliseBlobRelativePath(desiredPath, transcoded.storedMimeType);
  const relativePath = await resolveUniqueRelativePath(target.mountPointId, basePath);

  const parentDir = path.posix.dirname(relativePath);
  const folderId =
    parentDir !== '.' && parentDir !== '' && parentDir !== '/'
      ? await ensureFolderPath(target.mountPointId, parentDir)
      : null;

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
  const mirrorFileType = detectMirrorFileType(relativePath);
  const existingFile = await repos.docMountFiles.findByMountPointAndPath(
    target.mountPointId,
    relativePath
  );

  if (existingFile) {
    await repos.docMountChunks.deleteByFileId(existingFile.id);
    await repos.docMountFiles.update(existingFile.id, {
      sha256: blob.sha256,
      fileSizeBytes: blob.sizeBytes,
      lastModified: now,
      source: 'database',
      fileType: mirrorFileType,
      folderId,
      conversionStatus: 'skipped',
      conversionError: null,
      plainTextLength: null,
      chunkCount: 0,
    });
  } else {
    await repos.docMountFiles.create({
      mountPointId: target.mountPointId,
      relativePath,
      fileName: path.posix.basename(relativePath),
      fileType: mirrorFileType,
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
  }

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

/**
 * Read the bytes for a mount-blob storageKey. Returns null if the key is
 * malformed or the blob no longer exists.
 */
export async function readMountBlob(storageKey: string): Promise<Buffer | null> {
  const parsed = parseMountBlobStorageKey(storageKey);
  if (!parsed) return null;
  const repos = getRepositories();
  return repos.docMountBlobs.readData(parsed.blobId);
}

/**
 * True when the blob for a mount-blob storageKey exists.
 */
export async function mountBlobExists(storageKey: string): Promise<boolean> {
  const parsed = parseMountBlobStorageKey(storageKey);
  if (!parsed) return false;
  const repos = getRepositories();
  const metadata = await repos.docMountBlobs.findById(parsed.blobId);
  return !!metadata;
}

/**
 * Delete the blob and mirror file row for a mount-blob storageKey. No-op
 * when the key is malformed or the blob has already been removed.
 */
export async function deleteMountBlob(storageKey: string): Promise<void> {
  const parsed = parseMountBlobStorageKey(storageKey);
  if (!parsed) return;
  const repos = getRepositories();

  const metadata = await repos.docMountBlobs.findById(parsed.blobId);
  if (!metadata) return;

  const mirror = await repos.docMountFiles.findByMountPointAndPath(
    metadata.mountPointId,
    metadata.relativePath
  );
  if (mirror) {
    await repos.docMountChunks.deleteByFileId(mirror.id);
    await repos.docMountFiles.delete(mirror.id);
  }
  await repos.docMountBlobs.delete(parsed.blobId);
  repos.docMountPoints.refreshStats(metadata.mountPointId).catch(() => { /* best-effort */ });
}

// ============================================================================
// Internal helpers
// ============================================================================

function normaliseFolderDir(folderPath?: string | null): string {
  if (!folderPath) return '';
  const trimmed = folderPath.replace(/^\/+|\/+$/g, '').replace(/\\+/g, '/');
  if (!trimmed) return '';
  const parts = trimmed
    .split('/')
    .map(seg => seg.replace(UNSAFE_LEAF_CHARS, '_'))
    .filter(seg => seg.length > 0);
  return parts.join('/');
}

function detectMirrorFileType(relativePath: string): 'pdf' | 'docx' | 'blob' {
  const ext = path.extname(relativePath).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx') return 'docx';
  return 'blob';
}
