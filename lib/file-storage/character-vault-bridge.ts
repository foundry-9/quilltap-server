/**
 * Character Vault Bridge
 *
 * The character analog to `project-store-bridge.ts`. When a character has a
 * linked database-backed character vault (`characters.characterDocumentMountPointId`),
 * generated and seeded avatars are written into that vault's blob table
 * instead of onto disk. The returned storageKey is the same shim the project
 * bridge uses:
 *
 *   mount-blob:{mountPointId}:{blobId}
 *
 * so existing `FileStorageManager.downloadFile`/`fileExists`/`deleteFile`
 * call sites resolve the bytes without any change. The mount-blob helpers
 * (`isMountBlobStorageKey`, `readMountBlob`, etc.) live in `project-store-bridge.ts`
 * and are mount-point-agnostic — they work for any database-backed mount
 * regardless of storeType.
 *
 * Layout inside the vault:
 *
 *   images/avatar.webp                 — the canonical main avatar
 *                                        (overwritten in place; main is a
 *                                        snapshot of `defaultImageId` at write
 *                                        time, not a live alias)
 *   images/history/<safeFilename>      — every generated history entry; the
 *                                        original timestamped filename is
 *                                        preserved, with `(2)` etc. collision
 *                                        bumping
 *
 * Filesystem and Obsidian character mounts are intentionally not handled here —
 * a filesystem-backed vault already manages its own on-disk layout.
 *
 * @module file-storage/character-vault-bridge
 */

import path from 'path';
import { createHash } from 'crypto';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { transcodeToWebP, normaliseBlobRelativePath } from '@/lib/mount-index/blob-transcode';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import { emitDocumentWritten } from '@/lib/mount-index/db-store-events';
import { buildMountBlobStorageKey } from './project-store-bridge';

interface CharacterVaultTarget {
  mountPointId: string;
  mountPointName: string;
}

const MAIN_AVATAR_PATH = 'images/avatar.webp';
const HISTORY_FOLDER = 'images/history';

/**
 * Look up the database-backed character vault for the given character, if any.
 * Returns null when the character has no vault, when the vault row points at a
 * filesystem/obsidian mount, or when the vault row is missing.
 */
export async function getCharacterVaultStore(
  characterId: string | null | undefined
): Promise<CharacterVaultTarget | null> {
  if (!characterId) return null;

  try {
    const repos = getRepositories();
    const character = await repos.characters.findById(characterId);
    if (!character?.characterDocumentMountPointId) return null;

    const mp = await repos.docMountPoints.findById(character.characterDocumentMountPointId);
    if (!mp) return null;
    if (mp.mountType !== 'database') return null;
    if (mp.storeType !== 'character') return null;

    return { mountPointId: mp.id, mountPointName: mp.name };
  } catch (error) {
    logger.warn('Failed to resolve character vault store', {
      context: 'file-storage.character-vault-bridge',
      characterId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

interface WriteAvatarInput {
  characterId: string;
  /**
   * `'main'` overwrites `images/avatar.webp` in place; `'history'` appends a
   * new blob under `images/history/` with collision bumping.
   */
  kind: 'main' | 'history';
  /** Original filename — used as-is for history; ignored for main. */
  filename: string;
  content: Buffer;
  contentType: string;
  description?: string;
}

interface WriteAvatarResult {
  storageKey: string;
  mountPointId: string;
  blobId: string;
  relativePath: string;
  storedMimeType: string;
  sizeBytes: number;
  sha256: string;
}

/**
 * Write an avatar into the character's vault. Caller must have verified that
 * a vault exists via `getCharacterVaultStore()`; this throws otherwise.
 *
 * For `kind: 'main'` any existing blob at `images/avatar.webp` is replaced
 * (delete-then-insert under a single transaction-friendly path). For
 * `kind: 'history'` the original filename is preserved with `(2)` etc.
 * collision bumping inside `images/history/`.
 *
 * Image MIME types that sharp can decode are transcoded to WebP; everything
 * else is stored as-is — the same policy the project bridge uses.
 */
export async function writeCharacterAvatarToVault(
  input: WriteAvatarInput
): Promise<WriteAvatarResult> {
  const target = await getCharacterVaultStore(input.characterId);
  if (!target) {
    throw new Error(
      `Character ${input.characterId} has no linked database-backed vault`
    );
  }

  const repos = getRepositories();
  const transcoded = await transcodeToWebP(input.content, input.contentType);

  let relativePath: string;
  let folderId: string | null;

  if (input.kind === 'main') {
    relativePath = MAIN_AVATAR_PATH;
    folderId = await ensureFolderPath(target.mountPointId, 'images');

    // Delete any prior blob + mirror file at the canonical main path so the
    // unique (mountPointId, relativePath) index can take the new row.
    const existingMirror = await repos.docMountFiles.findByMountPointAndPath(
      target.mountPointId,
      relativePath
    );
    if (existingMirror) {
      await repos.docMountChunks.deleteByFileId(existingMirror.id);
      await repos.docMountFiles.delete(existingMirror.id);
    }
    await repos.docMountBlobs.deleteByMountPointAndPath(target.mountPointId, relativePath);
  } else {
    const safeName = sanitizeLeafName(input.filename);
    const desiredPath = `${HISTORY_FOLDER}/${safeName}`;
    const basePath = normaliseBlobRelativePath(desiredPath, transcoded.storedMimeType);
    relativePath = await resolveUniqueRelativePath(target.mountPointId, basePath);
    folderId = await ensureFolderPath(target.mountPointId, HISTORY_FOLDER);
  }

  const safeOriginalName = sanitizeLeafName(input.filename);
  const blob = await repos.docMountBlobs.create({
    mountPointId: target.mountPointId,
    relativePath,
    originalFileName: safeOriginalName || path.posix.basename(relativePath),
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
// Internal helpers — mirror project-store-bridge.ts intentionally; the small
// duplication is preferable to leaking helpers across modules whose contracts
// might diverge later.
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
