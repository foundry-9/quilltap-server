/**
 * Inventory object pictures — mirrors `lib/wardrobe/item-images.ts`.
 *
 * Each picture's bytes are a blob link under `Inventory/images/<itemId>/` in
 * the object's own tier mount, plus a `files` row (`linkedTo: [itemId]`,
 * category IMAGE). The history is `files.findByLinkedTo(itemId)`; the object
 * file carries only the current pick, `imageFileId`. The generic steps
 * (listing, the choice check, removal, transfer carry) are the wardrobe's,
 * called with the Inventory's images folder.
 *
 * An instance with no pictures of its own shows its archetype's, read-only
 * ({@link listInventoryImagesWithFallthrough}).
 *
 * Picture is for choosing, not for display (spec §2): the client shows it
 * only in pickers, the editor and the viewer.
 *
 * Server-only.
 *
 * @module lib/inventory/item-images
 */

import { logger } from '@/lib/logger';
import {
  INVENTORY_IMAGES_FOLDER,
  writeWardrobeItemImage,
  type WardrobeImageKind,
} from '@/lib/file-storage/wardrobe-image-bridge';
import { createGeneratedFileRow } from '@/lib/files/generated-file-row';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { FileEntry, FileSource } from '@/lib/schemas/file.types';
import type { InventoryRecord, ResolvedInventoryItem } from '@/lib/schemas/inventory.types';
import {
  assertItemImageChoice,
  carryItemImages,
  cleanupItemImages,
  commitMovedImages,
  ForeignWardrobeImageError,
  listWardrobeItemImages,
  removeImageFile,
  toWardrobeImageSummary,
  type PendingImageMove,
  type WardrobeItemImageSummary,
} from '@/lib/wardrobe/item-images';
import { resolveInventoryLocation, type InventoryLocation } from '@/lib/inventory/location';
import { loadPoolForLocation } from '@/lib/inventory/pool';

const LOG_CONTEXT = 'inventory.item-images';

export { INVENTORY_IMAGES_FOLDER, ForeignWardrobeImageError as ForeignInventoryImageError };
export type InventoryImageSummary = WardrobeItemImageSummary & { inherited?: boolean };

/** An object located in its tier, with the means to write it back. */
export interface InventoryItemHome {
  location: InventoryLocation;
  record: InventoryRecord;
  /** The resolved object (an instance's archetype filled in). */
  item: ResolvedInventoryItem;
}

/** The object's own pictures, newest first. */
export function listInventoryItemImages(
  repos: Pick<RepositoryContainer, 'files'>,
  itemId: string,
): Promise<FileEntry[]> {
  return listWardrobeItemImages(repos, itemId);
}

/**
 * The pictures to show for an object: its own, or — for an instance with
 * none — its archetype's, marked `inherited` (read-only).
 */
export async function listInventoryImagesWithFallthrough(
  repos: Pick<RepositoryContainer, 'files'>,
  item: Pick<ResolvedInventoryItem, 'id' | 'parentId'>,
): Promise<InventoryImageSummary[]> {
  const own = await listInventoryItemImages(repos, item.id);
  if (own.length > 0 || !item.parentId) return own.map(toWardrobeImageSummary);
  const inherited = await listInventoryItemImages(repos, item.parentId);
  logger.debug('[InventoryImages] Instance shows its archetype\'s pictures', {
    context: LOG_CONTEXT,
    itemId: item.id,
    parentId: item.parentId,
    count: inherited.length,
  });
  return inherited.map((file) => ({ ...toWardrobeImageSummary(file), inherited: true }));
}

/** Refuse an `imageFileId` that is not one of the object's own pictures. */
export function assertInventoryImageChoice(
  repos: Pick<RepositoryContainer, 'files'>,
  itemId: string,
  fileId: string | null | undefined,
): Promise<void> {
  return assertItemImageChoice(repos, itemId, fileId);
}

const SOURCE_BY_KIND: Record<WardrobeImageKind, FileSource> = {
  generated: 'GENERATED',
  uploaded: 'UPLOADED',
  imported: 'IMPORTED',
};

export interface AddInventoryItemImageInput {
  userId: string;
  kind: WardrobeImageKind;
  content: Buffer;
  contentType: string;
  width?: number | null;
  height?: number | null;
  generationPrompt?: string | null;
  generationModel?: string | null;
  generationRevisedPrompt?: string | null;
}

/** Store a new picture for the object and make it current. */
export async function addInventoryItemImage(
  repos: RepositoryContainer,
  home: InventoryItemHome,
  input: AddInventoryItemImageInput,
): Promise<{ file: FileEntry; record: InventoryRecord | null }> {
  const mountPointId = await home.location.writableMountPointId();
  const written = await writeWardrobeItemImage({
    mountPointId,
    itemId: home.record.id,
    kind: input.kind,
    content: input.content,
    contentType: input.contentType,
    description: `Inventory image for “${home.item.title || home.item.name}”`,
    imagesFolder: INVENTORY_IMAGES_FOLDER,
  });
  const file = await createGeneratedFileRow(repos, {
    userId: input.userId,
    sha256: written.sha256,
    originalFilename: written.leafName,
    stored: written,
    width: input.width ?? null,
    height: input.height ?? null,
    linkedTo: [home.record.id],
    tags: [home.record.id],
    source: SOURCE_BY_KIND[input.kind],
    generation: {
      prompt: input.generationPrompt ?? null,
      model: input.generationModel ?? null,
      revisedPrompt: input.generationRevisedPrompt ?? null,
    },
  });
  const record = await home.location.update(home.record.id, { imageFileId: file.id });
  logger.info('[InventoryImages] Added inventory object image', {
    context: LOG_CONTEXT,
    scope: home.location.scope,
    itemId: home.record.id,
    fileId: file.id,
    kind: input.kind,
    sizeBytes: written.sizeBytes,
  });
  return { file, record };
}

/** Make one of the object's own pictures current. */
export async function setCurrentInventoryItemImage(
  repos: RepositoryContainer,
  home: InventoryItemHome,
  fileId: string,
): Promise<string> {
  await assertInventoryImageChoice(repos, home.record.id, fileId);
  await home.location.writableMountPointId();
  await home.location.update(home.record.id, { imageFileId: fileId });
  logger.debug('[InventoryImages] Set current inventory object image', { context: LOG_CONTEXT, itemId: home.record.id, fileId });
  return fileId;
}

/** Delete one of the object's pictures; the next-newest becomes current. */
export async function deleteInventoryItemImage(
  repos: RepositoryContainer,
  home: InventoryItemHome,
  fileId: string,
): Promise<string | null> {
  const images = await listInventoryItemImages(repos, home.record.id);
  const target = images.find((f) => f.id === fileId);
  if (!target) throw new ForeignWardrobeImageError(home.record.id, fileId);
  await home.location.writableMountPointId();
  await removeImageFile(repos, home.record.id, target, INVENTORY_IMAGES_FOLDER);
  let current = home.record.imageFileId ?? null;
  if (current === fileId || (current && !images.some((f) => f.id === current))) {
    current = images.find((f) => f.id !== fileId)?.id ?? null;
    await home.location.update(home.record.id, { imageFileId: current });
  }
  logger.info('[InventoryImages] Deleted inventory object image', { context: LOG_CONTEXT, itemId: home.record.id, fileId, current });
  return current;
}

/** Drop every picture of a deleted object. Logs, never throws. */
export function cleanupInventoryItemImages(
  repos: RepositoryContainer,
  itemId: string,
  logTag: string,
  meta: Record<string, unknown>,
): Promise<void> {
  return cleanupItemImages(repos, itemId, logTag, meta, INVENTORY_IMAGES_FOLDER);
}

/** Carry an object's pictures to another mount for a transfer (see the wardrobe's). */
export function carryInventoryItemImages(
  repos: RepositoryContainer,
  args: { mode: 'move' | 'copy'; sourceItemId: string; destinationItemId: string; destinationMountPointId: string; userId: string },
): Promise<{ fileIdMap: Map<string, string>; pendingMove: PendingImageMove }> {
  return carryItemImages(repos, { ...args, imagesFolder: INVENTORY_IMAGES_FOLDER });
}

/** Finish a move's pictures once the object has landed. */
export function commitMovedInventoryImages(
  repos: Pick<RepositoryContainer, 'files'>,
  itemId: string,
  pending: PendingImageMove,
): Promise<void> {
  return commitMovedImages(repos, itemId, pending, INVENTORY_IMAGES_FOLDER);
}

/**
 * Find `itemId` in the named tier, resolved, or null when the tier does not
 * resolve or does not hold it. A read: a store that does not exist yet is not
 * provisioned.
 */
export async function resolveInventoryItemHome(
  repos: RepositoryContainer,
  userId: string,
  scope: InventoryLocation['scope'],
  containerId: string | null | undefined,
  itemId: string,
): Promise<InventoryItemHome | null> {
  const location = await resolveInventoryLocation(scope, containerId, repos, userId);
  if (!location) return null;
  const record = await location.findItem(itemId);
  if (!record) return null;
  const pool = await loadPoolForLocation(repos, location);
  return { location, record, item: pool.resolve(record) };
}
