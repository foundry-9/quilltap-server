/**
 * Inventory Object Images API v1 — the shared item images route
 * (`createItemImagesRoute`, `lib/mount-index/item-images-route.ts`, which the
 * wardrobe's route uses too); this file is the Inventory's adapter.
 *
 * One route for every tier; the container rides in the query.
 *
 * GET  /api/v1/inventory/[itemId]/images?scope=<scope>&id=<containerId>
 *   → { current, images: [{ fileId, url, thumbnailUrl, source, createdAt, prompt?, model?, inherited? }] }
 *   An instance with no pictures of its own lists its archetype's, marked
 *   `inherited` (read-only).
 * POST …?action=generate      body { imageProfileId? } → { image, current, prompt, profile, rerouted, trail }
 * POST …?action=upload        multipart `file` (+ `kind`)  → { image, current }
 * POST …?action=set-current   body { fileId }          → { current }
 * POST …?action=delete-image  body { fileId }          → { current }
 * GET  …?action=save-targets                           → { albums }
 * POST …?action=save-to-store body { fileId, mountPointId, caption? }
 *
 * A write against an archived character's object answers 409. Only the
 * pictures the object shows (for an instance with none, its archetype's) may
 * be saved to a store.
 */

import { toWardrobeImageSummary } from '@/lib/wardrobe/item-images';
import {
  addInventoryItemImage,
  deleteInventoryItemImage,
  listInventoryImagesWithFallthrough,
  resolveInventoryItemHome,
  setCurrentInventoryItemImage,
  type InventoryItemHome,
} from '@/lib/inventory/item-images';
import {
  InventoryImageGenerationError,
  NoInventoryImageProfileError,
  generateInventoryItemImage,
} from '@/lib/inventory/item-image-generation';
import { inventoryErrorResponse } from '@/lib/inventory/routes/responses';
import { createItemImagesRoute } from '@/lib/mount-index/item-images-route';

export const { GET, POST } = createItemImagesRoute<InventoryItemHome>({
  logTag: '[Inventory Images v1]',
  context: 'inventory',
  messages: {
    itemNotFound: 'Inventory object',
    foreignPicture: 'That picture does not belong to this object',
    invalidJson: 'Request body is not valid JSON',
    refusedSubject: 'this object',
  },
  resolveHome: resolveInventoryItemHome,
  listImages: (repos, home) => listInventoryImagesWithFallthrough(repos, home.item),
  captionOf: (home) => home.item.title || home.item.name,
  summarize: toWardrobeImageSummary,
  generate: async (repos, { userId, home, imageProfileId }) => {
    const { fileId, prompt, profile, rerouted, trail } = await generateInventoryItemImage(repos, { userId, home, imageProfileId });
    return { fileId, extras: { prompt, profile, rerouted, trail } };
  },
  noProfileError: NoInventoryImageProfileError,
  generationError: InventoryImageGenerationError,
  addImage: addInventoryItemImage,
  setCurrent: setCurrentInventoryItemImage,
  deleteImage: deleteInventoryItemImage,
  errorResponse: (error) => inventoryErrorResponse(error),
});
