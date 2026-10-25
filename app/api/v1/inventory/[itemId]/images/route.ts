/**
 * Inventory Object Images API v1 — mirrors the wardrobe's item images route.
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
 * A write against an archived character's object answers 409.
 */

import type { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createContextParamsHandler, withActionDispatch } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/context';
import { logger } from '@/lib/logger';
import { badRequest, conflict, created, errorResponse, notFound, successResponse } from '@/lib/api/responses';
import { trackActivity } from '@/lib/background-jobs/activity-registry';
import { validateImageFile } from '@/lib/images-v2';
import { convertToWebP } from '@/lib/files/webp-conversion';
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
import { inventoryErrorResponse, withInventoryErrors } from '@/lib/inventory/routes/responses';
import { InventoryScopeSchema } from '@/lib/schemas/inventory.types';
import { saveImageToAlbum, SaveImageToAlbumError, SaveImageRequestSchema } from '@/lib/photos/save-image-to-album';
import { savedImageResponse, saveImageErrorResponse } from '@/lib/photos/save-image-response';
import { listAllPhotoAlbumOptions } from '@/lib/photos/photo-album-options';
import { getArchivedCharacterVaultMountPointIds } from '@/lib/mount-index/character-vault';

type Params = { itemId: string };
const LOG_TAG = '[Inventory Images v1]';

const containerQuerySchema = z
  .object({ scope: InventoryScopeSchema, id: z.string().min(1).optional() })
  .refine((q) => q.scope === 'general' || !!q.id, { message: 'id is required for this scope' });
const generateBodySchema = z.object({ imageProfileId: z.string().min(1).nullable().optional() });
const fileIdBodySchema = z.object({ fileId: z.string().min(1, 'fileId is required') });
const uploadKindSchema = z.enum(['uploaded', 'imported']).default('uploaded');

async function findHome(
  req: NextRequest,
  { user, repos }: RequestContext,
  itemId: string,
): Promise<{ ok: true; home: InventoryItemHome } | { ok: false; response: NextResponse }> {
  const sp = req.nextUrl.searchParams;
  const parsed = containerQuerySchema.safeParse({ scope: sp.get('scope') ?? undefined, id: sp.get('id') ?? undefined });
  if (!parsed.success) return { ok: false, response: badRequest(parsed.error.issues.map((i) => i.message).join('; ')) };
  const home = await resolveInventoryItemHome(repos, user.id, parsed.data.scope, parsed.data.id ?? null, itemId);
  if (!home) return { ok: false, response: notFound('Inventory object') };
  return { ok: true, home };
}

async function handleList(req: NextRequest, ctx: RequestContext, { itemId }: Params) {
  const found = await findHome(req, ctx, itemId);
  if (!found.ok) return found.response;
  const images = await listInventoryImagesWithFallthrough(ctx.repos, found.home.item);
  const ids = new Set(images.map((image) => image.fileId));
  const wanted = found.home.item.imageFileId ?? null;
  const current = wanted && ids.has(wanted) ? wanted : null;
  logger.debug(`${LOG_TAG} Listed object images`, { itemId, count: images.length, current, context: 'inventory' });
  return successResponse({ current, images });
}

async function handleGenerate(req: NextRequest, ctx: RequestContext, { itemId }: Params) {
  const found = await findHome(req, ctx, itemId);
  if (!found.ok) return found.response;
  // An empty body means "the default profile"; a malformed one is the
  // caller's error (400), never a 500.
  const text = await req.text();
  let raw: unknown = {};
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      logger.debug(`${LOG_TAG} Generate body is not valid JSON`, { itemId, context: 'inventory' });
      return badRequest('Request body is not valid JSON');
    }
  }
  const parsed = generateBodySchema.safeParse(raw);
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '));
  try {
    const result = await trackActivity('image', () =>
      generateInventoryItemImage(ctx.repos, { userId: ctx.user.id, home: found.home, imageProfileId: parsed.data.imageProfileId ?? null }),
    );
    const file = await ctx.repos.files.findById(result.fileId);
    return created({
      image: file ? toWardrobeImageSummary(file) : { fileId: result.fileId },
      current: result.fileId,
      prompt: result.prompt,
      profile: result.profile,
      rerouted: result.rerouted,
      trail: result.trail,
    });
  } catch (error) {
    if (error instanceof NoInventoryImageProfileError) return badRequest(error.message);
    if (error instanceof InventoryImageGenerationError) {
      return errorResponse(
        error.refused ? 'The image provider declined to draw this object' : `Image generation failed: ${error.message}`,
        error.refused ? 422 : 502,
        { trail: error.trail, refused: error.refused },
      );
    }
    return inventoryErrorResponse(error);
  }
}

async function handleUpload(req: NextRequest, ctx: RequestContext, { itemId }: Params) {
  const found = await findHome(req, ctx, itemId);
  if (!found.ok) return found.response;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return badRequest('Expected a multipart upload');
  }
  const file = form.get('file');
  if (!(file instanceof File)) return badRequest('No file provided');
  try {
    validateImageFile(file);
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : 'Invalid image');
  }
  const kind = uploadKindSchema.safeParse(form.get('kind') ?? undefined);
  if (!kind.success) return badRequest('kind must be "uploaded" or "imported"');
  const converted = await convertToWebP(Buffer.from(await file.arrayBuffer()), file.type, file.name);
  const { file: stored } = await addInventoryItemImage(ctx.repos, found.home, {
    userId: ctx.user.id,
    kind: kind.data,
    content: converted.buffer,
    contentType: converted.mimeType,
    width: converted.width ?? null,
    height: converted.height ?? null,
  });
  logger.info(`${LOG_TAG} Uploaded object image`, { itemId, fileId: stored.id, context: 'inventory' });
  return created({ image: toWardrobeImageSummary(stored), current: stored.id });
}

async function handleSetCurrent(req: NextRequest, ctx: RequestContext, { itemId }: Params) {
  const found = await findHome(req, ctx, itemId);
  if (!found.ok) return found.response;
  const { fileId } = fileIdBodySchema.parse(await req.json());
  return successResponse({ current: await setCurrentInventoryItemImage(ctx.repos, found.home, fileId) });
}

async function handleDeleteImage(req: NextRequest, ctx: RequestContext, { itemId }: Params) {
  const found = await findHome(req, ctx, itemId);
  if (!found.ok) return found.response;
  const { fileId } = fileIdBodySchema.parse(await req.json());
  return successResponse({ current: await deleteInventoryItemImage(ctx.repos, found.home, fileId) });
}

async function handleSaveTargets(req: NextRequest, ctx: RequestContext, { itemId }: Params) {
  const found = await findHome(req, ctx, itemId);
  if (!found.ok) return found.response;
  return successResponse({ albums: await listAllPhotoAlbumOptions(ctx.repos) });
}

async function handleSaveToStore(req: NextRequest, ctx: RequestContext, { itemId }: Params) {
  const found = await findHome(req, ctx, itemId);
  if (!found.ok) return found.response;
  const parsed = SaveImageRequestSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '));
  const { fileId, mountPointId, caption, tags } = parsed.data;
  // Only the object's own pictures (or, for an instance with none, the
  // archetype's it shows) leave through this door.
  const allowed = await listInventoryImagesWithFallthrough(ctx.repos, found.home.item);
  if (!allowed.some((image) => image.fileId === fileId)) return badRequest('That picture does not belong to this object');
  if ((await getArchivedCharacterVaultMountPointIds()).includes(mountPointId)) {
    return conflict('That store belongs to an archived character and cannot be written to');
  }
  try {
    const saved = await saveImageToAlbum({
      mountPointId,
      fileId,
      caption: caption ?? (found.home.item.title || found.home.item.name),
      tags: tags ?? [],
      attribution: { name: ctx.user.name ?? 'Quilltap', id: ctx.user.id ?? null, role: 'user' },
    });
    logger.info(`${LOG_TAG} Saved object picture to a store`, { itemId, fileId, mountPointId, context: 'inventory' });
    return savedImageResponse(saved);
  } catch (error) {
    if (error instanceof SaveImageToAlbumError) return saveImageErrorResponse(error);
    throw error;
  }
}

export const GET = createContextParamsHandler<Params>(
  withActionDispatch<Params>({ 'save-targets': handleSaveTargets }, handleList),
);

export const POST = createContextParamsHandler<Params>(
  withActionDispatch<Params>({
    generate: handleGenerate,
    upload: withInventoryErrors(handleUpload),
    'set-current': withInventoryErrors(handleSetCurrent),
    'delete-image': withInventoryErrors(handleDeleteImage),
    'save-to-store': handleSaveToStore,
  }),
);
