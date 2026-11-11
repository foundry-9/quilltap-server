/**
 * Inventory object pictures — a binding of the item-store kernel's pictures
 * (`createItemImages`, `lib/mount-index/item-family-images.ts`) over
 * `Inventory/images/`.
 *
 * Each picture's bytes are a blob link under `Inventory/images/<itemId>/` in
 * the object's own tier mount, plus a `files` row (`linkedTo: [itemId]`); the
 * object file carries only the current pick, `imageFileId`. An instance with
 * no pictures of its own shows its archetype's, read-only
 * ({@link listInventoryImagesWithFallthrough}).
 *
 * Picture is for choosing, not for display (spec §2): the client shows it
 * only in pickers, the editor and the viewer. The subject of a generated one
 * is the object's `imageDescription`, then its `description`, then its name:
 * an object-icon still life. Log rows are `INVENTORY_ITEM_IMAGE`.
 *
 * Server-only.
 *
 * @module lib/inventory/item-images
 */

import { INVENTORY_IMAGES_FOLDER } from '@/lib/file-storage/wardrobe-image-bridge';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { FileEntry } from '@/lib/schemas/file.types';
import type { InventoryRecord, ResolvedInventoryItem } from '@/lib/schemas/inventory.types';
import { resolveInventoryLocation, type InventoryLocation } from '@/lib/inventory/location';
import { loadPoolForLocation } from '@/lib/inventory/pool';
import {
  createItemImages,
  ForeignItemImageError,
  type AddItemImageInput,
  type ItemImageGenerationResult,
  type ItemImageHome,
  type ItemImageSummary,
} from '@/lib/mount-index/item-family-images';

export { INVENTORY_IMAGES_FOLDER, ForeignItemImageError as ForeignInventoryImageError };
export type InventoryImageSummary = ItemImageSummary;

/** An object located in its tier; `item` is the object resolved (an instance's archetype filled in). */
export type InventoryItemHome = ItemImageHome<InventoryRecord, ResolvedInventoryItem, InventoryLocation>;
export type AddInventoryItemImageInput = AddItemImageInput;
export type InventoryItemImageGenerationResult = ItemImageGenerationResult;

type Subject = Pick<ResolvedInventoryItem, 'imageDescription' | 'description' | 'name' | 'title'>;

/** What the picture shows: `imageDescription ?? description ?? name`. */
export function inventoryImageSubject(item: Subject): string {
  const subject = item.imageDescription?.trim() || item.description?.trim() || item.title?.trim() || item.name;
  return subject.replace(/[.!?]+$/, '');
}

/** The object-icon prompt: one object, centred, plain ground, no person. Pure. */
export function buildInventoryItemImagePrompt(item: Subject): string {
  return `Still-life product photograph of ${inventoryImageSubject(item)}. A single object, centred, shown whole on a plain neutral ground, even soft light, no person and no hands. The object is the subject.`;
}

export const inventoryItemImages = createItemImages<InventoryRecord, ResolvedInventoryItem, InventoryLocation>({
  kind: 'inventory',
  imagesFolder: INVENTORY_IMAGES_FOLDER,
  tags: { images: '[InventoryImages]', generation: '[InventoryItemImage]' },
  noun: 'inventory object',
  idKey: 'itemId',
  describe: (item) => `Inventory image for “${item.title || item.name}”`,
  logType: 'INVENTORY_ITEM_IMAGE',
  buildPrompt: buildInventoryItemImagePrompt,
  noProfileMessage: 'No image profile is configured. Set one in Settings → Images before generating pictures of objects.',
  errorNames: { noProfile: 'NoInventoryImageProfileError', generation: 'InventoryImageGenerationError' },
  parentOf: (item) => item.parentId,
  resolveLocation: (scope, containerId, repos, userId) => resolveInventoryLocation(scope, containerId, repos, userId),
  find: (location, itemId) => location.findItem(itemId),
  resolveItem: async (repos, location, record) => (await loadPoolForLocation(repos, location)).resolve(record),
});

/** No usable profile (a 400). */
export const NoInventoryImageProfileError = inventoryItemImages.NoProfileError;
/** The provider refused or failed; carries the trail. */
export const InventoryImageGenerationError = inventoryItemImages.GenerationError;

/** The object's own pictures, newest first. */
export const listInventoryItemImages: (repos: Pick<RepositoryContainer, 'files'>, itemId: string) => Promise<FileEntry[]> =
  inventoryItemImages.list;

/**
 * The pictures to show for an object: its own, or — for an instance with
 * none — its archetype's, marked `inherited` (read-only).
 */
export function listInventoryImagesWithFallthrough(
  repos: Pick<RepositoryContainer, 'files'>,
  item: Pick<ResolvedInventoryItem, 'id' | 'parentId'>,
): Promise<InventoryImageSummary[]> {
  return inventoryItemImages.listShown(repos, item as ResolvedInventoryItem);
}

/** Refuse an `imageFileId` that is not one of the object's own pictures. */
export const assertInventoryImageChoice = inventoryItemImages.assertChoice;
/** Store a new picture for the object and make it current. */
export const addInventoryItemImage = inventoryItemImages.add;
/** Make one of the object's own pictures current. */
export const setCurrentInventoryItemImage = inventoryItemImages.setCurrent;
/** Delete one of the object's pictures; the next-newest becomes current. */
export const deleteInventoryItemImage = inventoryItemImages.remove;
/** Drop every picture of a deleted object. Logs, never throws. */
export const cleanupInventoryItemImages = inventoryItemImages.cleanup;
/** Carry an object's pictures to another mount for a transfer. */
export const carryInventoryItemImages = inventoryItemImages.carry;
/** Finish a move's pictures once the object has landed. */
export const commitMovedInventoryImages = inventoryItemImages.commitMoved;
/** Find `itemId` in the named tier, resolved, or null. A read: nothing is provisioned. */
export const resolveInventoryItemHome = inventoryItemImages.resolveHome;
/** Generate, store and make current a picture of `home.item`. */
export const generateInventoryItemImage = inventoryItemImages.generate;
