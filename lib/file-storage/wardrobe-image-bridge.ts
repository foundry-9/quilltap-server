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
 * (a second picture in the same second is bumped to `… (2).webp`). The write
 * is `storeMountFile` with `collisionStrategy: 'unique-suffix'` — the ingest
 * chokepoint, which reserves the path it picks, normalizes images to WebP and
 * de-duplicates by sha256 through `linkBlobContent` (an Import-from-image
 * photograph shared by N pieces is one blob behind N links). The returned
 * storageKey is the `mount-blob:{mountPointId}:{blobId}` shim every `files`
 * row reader already understands. This module adds only the path shape and
 * the host-RPC shim.
 *
 * The projection sweep in `vault-projection.ts` touches `.md` documents only,
 * so these blobs are never mistaken for garments and never swept — which is
 * also why they are not renamed or deleted with the item: the item routes
 * remove them explicitly (`lib/wardrobe/item-images.ts`).
 *
 * Writes run on the parent's RW connection. `writeWardrobeItemImage` is
 * reachable from the job child (`WARDROBE_ITEM_IMAGE_GENERATION`, queued by
 * the wardrobe tools) and routes there via host-RPC, the way the avatar and
 * Lantern bridges do: its `blobId` / `linkId` are server-computed and are
 * baked into the `files` row's storageKey, so a buffered synthetic id would
 * dangle. `deleteWardrobeItemImageLink` has no child caller and refuses.
 *
 * @module file-storage/wardrobe-image-bridge
 */

import path from 'path';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { storeMountFile } from '@/lib/mount-index/store-file';
import { emitDocumentDeleted } from '@/lib/mount-index/db-store-events';
import { buildMountBlobStorageKey } from './project-store-bridge';
import { sanitizeLeafName } from './bridge-path-helpers';

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
      `${operation} is parent-process only; wardrobe image links are removed from API routes, never from the job child`,
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
   * Re-use an exact leaf name (transfer re-linking keeps the source's; the
   * write upserts there). When omitted, a fresh `<timestamp>-<kind>.webp` is
   * minted and bumped on collision.
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
  if (process.env.QUILLTAP_JOB_CHILD === '1') {
    const { callHost } = await import('@/lib/background-jobs/child/host-rpc-client');
    logger.debug('[WardrobeImageBridge] Routing wardrobe image write to the parent', {
      context: LOG_CONTEXT,
      mountPointId: input.mountPointId,
      itemId: input.itemId,
    });
    return callHost<WriteWardrobeItemImageResult>('writeWardrobeItemImage', input);
  }

  const folder = wardrobeItemImageFolder(input.itemId);
  // A fresh picture gets a sortable `<timestamp>-<kind>.webp` leaf and lets
  // the pipeline bump it (` (2)`, ` (3)`…) if the second is already taken;
  // `storeMountFile` reserves the path it picks, so two writes in the same
  // second cannot both land on it. A transfer re-link keeps the source's
  // leaf exactly and upserts there.
  const desiredLeaf = input.leafName
    ? sanitizeLeafName(input.leafName)
    : `${timestampStem(new Date())}-${input.kind}.webp`;

  // storeMountFile is the ingest chokepoint: it ensures the folder, routes
  // the bytes through linkBlobContent (the image-normalization chokepoint,
  // which de-duplicates by sha256) and emits the document-written event.
  const stored = await storeMountFile({
    mountPointId: input.mountPointId,
    relativePath: `${folder}/${desiredLeaf}`,
    data: input.content,
    originalMimeType: input.contentType,
    originalFileName: desiredLeaf,
    description: input.description ?? '',
    collisionStrategy: input.leafName ? 'overwrite' : 'unique-suffix',
    treatNativeTextAsDocument: false,
    transcodeImages: true,
    extractText: false,
    enqueueEmbedding: false,
    assetStorage: 'database',
  });
  if (!stored.blobId || !stored.linkId) {
    throw new Error(`Wardrobe image write to ${stored.relativePath} produced no blob link`);
  }

  const result: WriteWardrobeItemImageResult = {
    storageKey: buildMountBlobStorageKey(input.mountPointId, stored.blobId),
    linkId: stored.linkId,
    blobId: stored.blobId,
    relativePath: stored.relativePath,
    leafName: path.posix.basename(stored.relativePath),
    storedMimeType: stored.storedMimeType,
    sha256: stored.sha256,
    sizeBytes: stored.sizeBytes,
  };

  logger.debug('[WardrobeImageBridge] Wrote wardrobe item image', {
    context: LOG_CONTEXT,
    mountPointId: input.mountPointId,
    itemId: input.itemId,
    kind: input.kind,
    relativePath: result.relativePath,
    blobId: result.blobId,
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
