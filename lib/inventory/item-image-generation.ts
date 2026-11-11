/**
 * Generate a picture of an Inventory object — the generation half of the
 * Inventory's binding of the item-store kernel's pictures
 * (`lib/inventory/item-images.ts`, over `createItemImages`): synchronously, in
 * the calling API route, through the Concierge's image failover chokepoint.
 * The subject is the object's `imageDescription`, then its `description`,
 * then its name; log rows are `INVENTORY_ITEM_IMAGE`.
 *
 * @module lib/inventory/item-image-generation
 */

export {
  InventoryImageGenerationError,
  NoInventoryImageProfileError,
  buildInventoryItemImagePrompt,
  generateInventoryItemImage,
  inventoryImageSubject,
  type InventoryItemImageGenerationResult,
} from '@/lib/inventory/item-images';
