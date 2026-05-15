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
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { transcodeToWebP, normaliseBlobRelativePath } from '@/lib/mount-index/blob-transcode';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import { emitDocumentWritten } from '@/lib/mount-index/db-store-events';
import { buildMountBlobStorageKey } from './project-store-bridge';
import { sanitizeLeafName, resolveUniqueRelativePath } from './bridge-path-helpers';

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

    // Drop any existing link at the canonical main path. deleteWithGC
    // takes the underlying file and its blob along if this was the last
    // reference — typical for character avatars, which aren't hard-linked
    // elsewhere yet.
    const existingLink = await repos.docMountFileLinks.findByMountPointAndPath(
      target.mountPointId,
      relativePath
    );
    if (existingLink) {
      await repos.docMountFileLinks.deleteWithGC(existingLink.id);
    }
  } else {
    const safeName = sanitizeLeafName(input.filename);
    const desiredPath = `${HISTORY_FOLDER}/${safeName}`;
    const basePath = normaliseBlobRelativePath(desiredPath, transcoded.storedMimeType);
    relativePath = await resolveUniqueRelativePath(target.mountPointId, basePath);
    folderId = await ensureFolderPath(target.mountPointId, HISTORY_FOLDER);
  }

  const safeOriginalName = sanitizeLeafName(input.filename);
  const { blobId } = await repos.docMountFileLinks.linkBlobContent({
    mountPointId: target.mountPointId,
    relativePath,
    fileName: path.posix.basename(relativePath),
    folderId,
    originalFileName: safeOriginalName || path.posix.basename(relativePath),
    originalMimeType: input.contentType,
    storedMimeType: transcoded.storedMimeType,
    sha256: transcoded.sha256,
    description: input.description ?? '',
    data: transcoded.data,
  });

  emitDocumentWritten({ mountPointId: target.mountPointId, relativePath });
  repos.docMountPoints.refreshStats(target.mountPointId).catch(() => { /* best-effort */ });

  return {
    storageKey: buildMountBlobStorageKey(target.mountPointId, blobId),
    mountPointId: target.mountPointId,
    blobId,
    relativePath,
    storedMimeType: transcoded.storedMimeType,
    sizeBytes: transcoded.data.length,
    sha256: transcoded.sha256,
  };
}

