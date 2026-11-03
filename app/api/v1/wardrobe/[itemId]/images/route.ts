/**
 * Wardrobe Item Images API v1
 *
 * One route for every wardrobe tier; the container rides in the query so the
 * four per-tier route families are not each grown four handlers. The handlers
 * are the shared item images route (`createItemImagesRoute`,
 * `lib/mount-index/item-images-route.ts`, which the Inventory's route uses
 * too); this file is the wardrobe's adapter.
 *
 * GET  /api/v1/wardrobe/[itemId]/images?scope=<scope>&id=<containerId>
 *   → { current, images: [{ fileId, url, thumbnailUrl, source, createdAt, prompt?, model? }] }
 *
 * POST …?action=generate      body { imageProfileId? }  → { image, current, prompt, subject, profile, rerouted, trail }
 * POST …?action=upload        multipart `file` (+ `kind`: uploaded | imported) → { image, current }
 * POST …?action=link-image    body { fileId }           → { image, current }
 * POST …?action=set-current   body { fileId }           → { current }
 * POST …?action=delete-image  body { fileId }           → { current }
 * GET  …?action=save-targets                            → { albums: PhotoAlbumOption[] }
 * POST …?action=save-to-store body { fileId, mountPointId, caption? } → { mountPoint, relativePath, … }
 *
 * `scope` ∈ character | project | group | general; `id` is required for all
 * but general. The item must live in the named container (404 otherwise). A
 * write against an archived character's item is refused with 409 — the
 * tombstone's `CharacterArchivedError` is mapped, never caught and retried.
 *
 * `link-image` is the wardrobe's own: it gives the item a copy-by-link of
 * another stored picture (Import from image's photograph, uploaded once).
 */

import type { NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { badRequest, conflict, created } from '@/lib/api/responses';
import { CharacterArchivedError } from '@/lib/database/repositories/characters.repository';
import {
  ForeignWardrobeImageError,
  UnlinkableWardrobeImageError,
  addWardrobeItemImage,
  deleteWardrobeItemImage,
  linkWardrobeItemImage,
  listWardrobeItemImages,
  resolveWardrobeItemHome,
  setCurrentWardrobeItemImage,
  toWardrobeImageSummary,
  type WardrobeItemHome,
} from '@/lib/wardrobe/item-images';
import {
  NoWardrobeImageProfileError,
  WardrobeImageGenerationError,
  generateWardrobeItemImage,
} from '@/lib/wardrobe/item-image-generation';
import {
  createItemImagesRoute,
  itemImageFileIdBodySchema,
  type ItemImagesAction,
} from '@/lib/mount-index/item-images-route';

const LOG_TAG = '[Wardrobe Images v1]';

/** The wardrobe's error mapping for every write action. */
function mapWriteError(error: unknown, meta: Record<string, unknown>): NextResponse {
  if (error instanceof CharacterArchivedError) {
    logger.info(`${LOG_TAG} Refused a picture write on an archived character`, meta);
    return conflict('This character is archived; their wardrobe cannot be changed');
  }
  if (error instanceof ForeignWardrobeImageError) {
    return badRequest('That picture does not belong to this wardrobe item');
  }
  if (error instanceof z.ZodError) {
    return badRequest(error.issues.map((i) => i.message).join('; '));
  }
  throw error;
}

// POST ?action=link-image — body { fileId }
const handleLinkImage: ItemImagesAction<WardrobeItemHome> = async (req, ctx, found, itemId) => {
  const meta = { itemId, scope: found.query.scope, context: 'wardrobe' };
  try {
    const { fileId } = itemImageFileIdBodySchema.parse(await req.json());
    const { file: stored } = await linkWardrobeItemImage(ctx.repos, found.home, {
      userId: ctx.user.id,
      sourceFileId: fileId,
    });
    logger.info(`${LOG_TAG} Linked an existing picture to a wardrobe item`, { ...meta, sourceFileId: fileId, fileId: stored.id });
    return created({ image: toWardrobeImageSummary(stored), current: stored.id });
  } catch (error) {
    if (error instanceof UnlinkableWardrobeImageError) {
      return badRequest('That picture cannot be linked');
    }
    return mapWriteError(error, meta);
  }
};

export const { GET, POST } = createItemImagesRoute<WardrobeItemHome>({
  logTag: LOG_TAG,
  context: 'wardrobe',
  messages: {
    itemNotFound: 'Wardrobe item',
    foreignPicture: 'That picture does not belong to this wardrobe item',
    invalidJson: 'Invalid JSON body',
    refusedSubject: 'this garment',
  },
  resolveHome: resolveWardrobeItemHome,
  listImages: async (repos, _home, itemId) => (await listWardrobeItemImages(repos, itemId)).map(toWardrobeImageSummary),
  captionOf: (home) => home.item.title,
  summarize: toWardrobeImageSummary,
  generate: async (repos, args) => {
    const { fileId, url, prompt, subject, profile, rerouted, trail } = await generateWardrobeItemImage(repos, args);
    return { fileId, url, extras: { prompt, subject, profile, rerouted, trail } };
  },
  noProfileError: NoWardrobeImageProfileError,
  generationError: WardrobeImageGenerationError,
  addImage: addWardrobeItemImage,
  setCurrent: setCurrentWardrobeItemImage,
  deleteImage: deleteWardrobeItemImage,
  errorResponse: mapWriteError,
  extraPostActions: { 'link-image': handleLinkImage },
});
