/**
 * Wardrobe Image Bridge
 *
 * Writes a wardrobe item's pictures into the mount that holds the item's
 * `Wardrobe/*.md` — a character vault, a group's or project's official store,
 * or Quilltap General — beside the markdown, keyed by item id so a rename
 * cannot orphan them:
 *
 *   Wardrobe/images/<itemId>/<yyyymmdd-hhmmss>-<kind>.webp
 *
 * The bytes go through `linkBlobContent`, which normalizes images to WebP,
 * de-duplicates by sha256 (an Import-from-image photograph shared by N pieces
 * is one blob behind N links) and mints the `doc_mount_files` /
 * `doc_mount_blobs` / `doc_mount_file_links` trio. The returned storageKey is
 * the `mount-blob:{mountPointId}:{blobId}` shim every `files` row reader
 * already understands.
 *
 * The projection sweep in `vault-projection.ts` touches `.md` documents only,
 * so these blobs are never mistaken for garments and never swept — which is
 * also why they are not renamed or deleted with the item: the item routes
 * remove them explicitly (`lib/wardrobe/item-images.ts`).
 *
 * Parent-process only. Every caller is an API route; rather than grow a
 * host-RPC arm nobody calls, the bridge refuses to run in the job child.
 *
 * @module file-storage/wardrobe-image-bridge
 */

import path from 'path';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import { emitDocumentDeleted, emitDocumentWritten } from '@/lib/mount-index/db-store-events';
import { sha256OfBuffer } from '@/lib/utils/sha256';
import { buildMountBlobStorageKey } from './project-store-bridge';
import { resolveUniqueRelativePath, sanitizeLeafName } from './bridge-path-helpers';

const LOG_CONTEXT = 'file-storage.wardrobe-image-bridge';

/** Where an item's pictures live inside its mount. */
export const WARDROBE_IMAGES_FOLDER = 'Wardrobe/images';

export type WardrobeImageKind = 'generated' | 'uploaded' | 'imported';

/** `Wardrobe/images/<itemId>` — the folder holding one item's pictures. */
export function wardrobeItemImageFolder(itemId: string): string {
  return `${WARDROBE_IMAGES_FOLDER}/${sanitizeLeafName(itemId)}`;
}

/** The mount-relative path of one picture, from its item id and leaf name. */
export function wardrobeItemImagePath(itemId: string, leafName: string): string {
  return `${wardrobeItemImageFolder(itemId)}/${leafName}`;
}

/** `20261007-142233` — UTC, sortable, filename-safe. */
function timestampStem(now: Date): string {
  const iso = now.toISOString(); // 2026-10-07T14:22:33.000Z
  return `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}`;
}

function refuseInJobChild(operation: string): void {
  if (process.env.QUILLTAP_JOB_CHILD === '1') {
    throw new Error(
      `${operation} is parent-process only; wardrobe images are written from API routes, never from the job child`,
    );
  }
}

export interface WriteWardrobeItemImageInput {
  mountPointId: string;
  itemId: string;
  kind: WardrobeImageKind;
  content: Buffer;
  contentType: string;
  description?: string;
  /**
   * Re-use an exact leaf name (transfer re-linking keeps the source's). When
   * omitted, a fresh `<timestamp>-<kind>.webp` is minted with collision
   * bumping.
   */
  leafName?: string;
}

export interface WriteWardrobeItemImageResult {
  storageKey: string;
  linkId: string;
  blobId: string;
  relativePath: string;
  /** The leaf the link landed on — what the `files` row records as `originalFilename`. */
  leafName: string;
  storedMimeType: string;
  sha256: string;
  sizeBytes: number;
}

/**
 * Write one picture for `itemId` into `mountPointId`. The caller resolves the
 * mount (and, for an archived character, lets `resolveWardrobeMount` refuse).
 */
export async function writeWardrobeItemImage(
  input: WriteWardrobeItemImageInput,
): Promise<WriteWardrobeItemImageResult> {
  refuseInJobChild('writeWardrobeItemImage');

  const repos = getRepositories();
  const folder = wardrobeItemImageFolder(input.itemId);
  const desiredLeaf = input.leafName
    ? sanitizeLeafName(input.leafName)
    : `${timestampStem(new Date())}-${input.kind}.webp`;
  const relativePath = input.leafName
    ? `${folder}/${desiredLeaf}`
    : await resolveUniqueRelativePath(input.mountPointId, `${folder}/${desiredLeaf}`);

  const folderId = await ensureFolderPath(input.mountPointId, folder);

  // No transcode here: linkBlobContent is the image-normalization chokepoint
  // and rewrites storedMimeType / relativePath to whatever it actually stores.
  const { link, blobId } = await repos.docMountFileLinks.linkBlobContent({
    mountPointId: input.mountPointId,
    relativePath,
    fileName: path.posix.basename(relativePath),
    folderId,
    originalFileName: path.posix.basename(relativePath),
    originalMimeType: input.contentType,
    storedMimeType: input.contentType,
    sha256: sha256OfBuffer(input.content),
    description: input.description ?? '',
    data: input.content,
  });

  emitDocumentWritten({ mountPointId: input.mountPointId, relativePath: link.relativePath });
  repos.docMountPoints.refreshStats(input.mountPointId).catch(() => { /* best-effort */ });

  const blob = await repos.docMountBlobs.findById(blobId);

  const result: WriteWardrobeItemImageResult = {
    storageKey: buildMountBlobStorageKey(input.mountPointId, blobId),
    linkId: link.id,
    blobId,
    relativePath: link.relativePath,
    leafName: path.posix.basename(link.relativePath),
    storedMimeType: blob?.storedMimeType ?? input.contentType,
    sha256: link.sha256,
    sizeBytes: link.fileSizeBytes,
  };

  logger.debug('[WardrobeImageBridge] Wrote wardrobe item image', {
    context: LOG_CONTEXT,
    mountPointId: input.mountPointId,
    itemId: input.itemId,
    kind: input.kind,
    relativePath: result.relativePath,
    blobId,
    sizeBytes: result.sizeBytes,
  });

  return result;
}

/**
 * Remove one picture's link from a mount. `deleteWithGC` drops the blob only
 * when this was its last link — an imported photograph shared with sibling
 * pieces survives. Returns whether a link was found.
 */
export async function deleteWardrobeItemImageLink(
  mountPointId: string,
  itemId: string,
  leafName: string,
): Promise<boolean> {
  refuseInJobChild('deleteWardrobeItemImageLink');

  const repos = getRepositories();
  const relativePath = wardrobeItemImagePath(itemId, leafName);
  const link = await repos.docMountFileLinks.findByMountPointAndPath(mountPointId, relativePath);
  if (!link) {
    logger.debug('[WardrobeImageBridge] No link to delete', {
      context: LOG_CONTEXT,
      mountPointId,
      relativePath,
    });
    return false;
  }

  const { fileGC } = await repos.docMountFileLinks.deleteWithGC(link.id);
  emitDocumentDeleted({ mountPointId, relativePath });
  repos.docMountPoints.refreshStats(mountPointId).catch(() => { /* best-effort */ });

  logger.debug('[WardrobeImageBridge] Deleted wardrobe item image link', {
    context: LOG_CONTEXT,
    mountPointId,
    relativePath,
    blobCollected: fileGC,
  });
  return true;
}
