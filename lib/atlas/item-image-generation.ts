/**
 * Generate a picture of an Atlas entry — the generation half of the Atlas's
 * binding of the item-store kernel's pictures (`lib/atlas/item-images.ts`,
 * over `createItemImages`): synchronously, in the calling API route, through
 * the Concierge's image failover chokepoint. The subject is the entry's
 * graphic prompt, else its name; log rows are `ATLAS_ENTRY_IMAGE`.
 *
 * @module lib/atlas/item-image-generation
 */

export {
  AtlasImageGenerationError,
  NoAtlasImageProfileError,
  atlasImageSubject,
  buildAtlasEntryImagePrompt,
  generateAtlasEntryImage,
  type AtlasEntryImageGenerationResult,
} from '@/lib/atlas/item-images';
