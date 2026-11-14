/**
 * Atlas Entry Images API v1 — the shared item images route
 * (`createItemImagesRoute`, `lib/mount-index/item-images-route.ts`); this
 * file is the Atlas's adapter. One route for every tier; the container rides
 * in the query.
 *
 * GET  /api/v1/atlas/[entryId]/images?scope=<scope>&id=<containerId>
 *   → { current, images: [{ fileId, url, thumbnailUrl, source, createdAt, prompt?, model? }] }
 * POST …?action=generate      body { imageProfileId? } → { image, current, prompt, profile, rerouted, trail }
 * POST …?action=upload        multipart `file` (+ `kind`)  → { image, current }
 * POST …?action=set-current   body { fileId }          → { current }
 * POST …?action=delete-image  body { fileId }          → { current }
 * GET  …?action=save-targets                           → { albums }
 * POST …?action=save-to-store body { fileId, mountPointId, caption? }
 *
 * A write against an archived character's entry answers 409. Pictures are for
 * the operator; no image model is ever handed one as a reference.
 */

import { toWardrobeImageSummary } from '@/lib/wardrobe/item-images';
import {
  addAtlasEntryImage,
  deleteAtlasEntryImage,
  listAtlasEntryImageSummaries,
  resolveAtlasEntryHome,
  setCurrentAtlasEntryImage,
  type AtlasEntryHome,
} from '@/lib/atlas/item-images';
import {
  AtlasImageGenerationError,
  NoAtlasImageProfileError,
  generateAtlasEntryImage,
} from '@/lib/atlas/item-image-generation';
import { atlasErrorResponse } from '@/lib/atlas/routes/responses';
import type { NextRequest } from 'next/server';
import { createItemImagesRoute } from '@/lib/mount-index/item-images-route';

const route = createItemImagesRoute<AtlasEntryHome>({
  logTag: '[Atlas Images v1]',
  context: 'atlas',
  messages: {
    itemNotFound: 'Atlas entry',
    foreignPicture: 'That picture does not belong to this entry',
    invalidJson: 'Request body is not valid JSON',
    refusedSubject: 'this entry',
  },
  resolveHome: resolveAtlasEntryHome,
  listImages: (repos, home) => listAtlasEntryImageSummaries(repos, home.record.id),
  captionOf: (home) => home.record.name,
  summarize: toWardrobeImageSummary,
  generate: async (repos, { userId, home, imageProfileId }) => {
    const { fileId, prompt, profile, rerouted, trail } = await generateAtlasEntryImage(repos, { userId, home, imageProfileId });
    return { fileId, extras: { prompt, profile, rerouted, trail } };
  },
  noProfileError: NoAtlasImageProfileError,
  generationError: AtlasImageGenerationError,
  addImage: addAtlasEntryImage,
  setCurrent: setCurrentAtlasEntryImage,
  deleteImage: deleteAtlasEntryImage,
  errorResponse: (error) => atlasErrorResponse(error),
});

/**
 * The shared route reads its item from an `itemId` param; this folder names
 * it `[entryId]` (beside the item route), so the param is renamed here.
 */
type EntryParams = { params: Promise<{ entryId: string }> };
const asItem = ({ params }: EntryParams) => ({ params: params.then(({ entryId }) => ({ itemId: entryId })) });

export const GET = (req: NextRequest, ctx: EntryParams) => route.GET(req, asItem(ctx));
export const POST = (req: NextRequest, ctx: EntryParams) => route.POST(req, asItem(ctx));
