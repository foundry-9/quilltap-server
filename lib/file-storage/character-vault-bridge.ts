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
import { transcodeToWebP } from '@/lib/mount-index/blob-transcode';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import { emitDocumentWritten } from '@/lib/mount-index/db-store-events';
import { storeMountFile } from '@/lib/mount-index/store-file';
import { buildMountBlobStorageKey } from './project-store-bridge';
import { sanitizeLeafName } from './bridge-path-helpers';

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
  /**
   * `doc_mount_file_links.id` of the freshly-written link. Post-Phase-3
   * this is what `character.defaultImageId` / `avatarOverrides[].imageId`
   * should be set to instead of a legacy `files.id`.
   */
  linkId: string;
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
  // In the forked job child the DB connection is readonly and writes are
  // buffered (no read-your-writes). The `linkBlobContent` insert below returns
  // a server-generated `blobId`/`linkId` (deduped by sha, so it may reference a
  // pre-existing blob) that gets baked into the returned `storageKey` and
  // persisted into `files.create`; a buffered/synthetic id would dangle. Route
  // the whole write to the parent's RW connection via host-RPC and return the
  // real result. Mirrors `FileStorageManager.uploadFile`.
  if (process.env.QUILLTAP_JOB_CHILD === '1') {
    const { callHost } = await import('@/lib/background-jobs/child/host-rpc-client');
    return callHost<WriteAvatarResult>('writeCharacterAvatarToVault', input);
  }

  const target = await getCharacterVaultStore(input.characterId);
  if (!target) {
    throw new Error(
      `Character ${input.characterId} has no linked database-backed vault`
    );
  }

  // -------------------------------------------------------------------------
  // `kind: 'main'` — overwrite the canonical main avatar in place.
  //
  // This path is intentionally NOT routed through storeMountFile because it
  // requires a deleteWithGC of the existing link (which cascades to the blob
  // row when it was the last reference) before writing the replacement.
  // storeMountFile's 'overwrite' strategy calls deleteAtDest, which is
  // filesystem-only and does not perform blob GC. Leaving this path as-is
  // preserves the exact delete-then-insert semantics.
  // -------------------------------------------------------------------------
  if (input.kind === 'main') {
    const repos = getRepositories();
    const transcoded = await transcodeToWebP(input.content, input.contentType);

    const relativePath = MAIN_AVATAR_PATH;
    const folderId = await ensureFolderPath(target.mountPointId, 'images');

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

    const safeOriginalName = sanitizeLeafName(input.filename);
    const { link, blobId } = await repos.docMountFileLinks.linkBlobContent({
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
      linkId: link.id,
      relativePath,
      storedMimeType: transcoded.storedMimeType,
      sizeBytes: transcoded.data.length,
      sha256: transcoded.sha256,
    };
  }

  // -------------------------------------------------------------------------
  // `kind: 'history'` — append a new blob with unique-suffix collision bumping.
  //
  // This path maps cleanly to storeMountFile (sanitize + unique-suffix +
  // transcode + linkBlobContent), so it is delegated to the pipeline.
  // -------------------------------------------------------------------------
  const safeName = sanitizeLeafName(input.filename);
  const desiredPath = `${HISTORY_FOLDER}/${safeName}`;

  const result = await storeMountFile({
    mountPointId: target.mountPointId,
    relativePath: desiredPath,
    data: input.content,
    originalMimeType: input.contentType,
    originalFileName: safeName,
    description: input.description,
    collisionStrategy: 'unique-suffix',
    treatNativeTextAsDocument: false,
    transcodeImages: true,
    extractText: false,
    enqueueEmbedding: false,
    assetStorage: 'database',
  });

  return {
    storageKey: buildMountBlobStorageKey(result.mountPointId, result.blobId!),
    mountPointId: result.mountPointId,
    blobId: result.blobId!,
    linkId: result.linkId!,
    relativePath: result.relativePath,
    storedMimeType: result.storedMimeType,
    sizeBytes: result.sizeBytes,
    sha256: result.sha256,
  };
}
