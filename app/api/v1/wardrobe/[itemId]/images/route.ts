/**
 * Wardrobe Item Images API v1
 *
 * One route for every wardrobe tier; the container rides in the query so the
 * four per-tier route families are not each grown four handlers.
 *
 * GET  /api/v1/wardrobe/[itemId]/images?scope=<scope>&id=<containerId>
 *   → { current, images: [{ fileId, url, thumbnailUrl, source, createdAt, prompt?, model? }] }
 *
 * POST …?action=generate      body { imageProfileId? }  → { image, prompt, subject, profile, rerouted, trail }
 * POST …?action=upload        multipart `file` (+ `kind`: uploaded | imported) → { image }
 * POST …?action=set-current   body { fileId }           → { current }
 * POST …?action=delete-image  body { fileId }           → { current }
 * GET  …?action=save-targets                            → { albums: PhotoAlbumOption[] }
 * POST …?action=save-to-store body { fileId, mountPointId, caption? } → { mountPoint, relativePath, … }
 *
 * `scope` ∈ character | project | group | general; `id` is required for all
 * but general. The item must live in the named container (404 otherwise). A
 * write against an archived character's item is refused with 409 — the
 * tombstone's `CharacterArchivedError` is mapped, never caught and retried.
 * Generation is synchronous and wrapped in `trackActivity('image', …)` so the
 * toolbar's Img chip lights for the whole call.
 *
 * `save-targets` / `save-to-store` back the full-screen picture viewer's Save:
 * the same `SaveImageDialog` the Salon uses, offering every document store
 * (archived characters' vaults excluded) and filing a copy through the shared
 * `saveImageToAlbum` service. The picture must be one of the item's own; the
 * item itself is not changed, so an archived character's item may still be
 * copied *out*.
 */

import type { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createContextParamsHandler, withActionDispatch } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/context';
import { logger } from '@/lib/logger';
import {
  badRequest,
  conflict,
  errorResponse,
  notFound,
  successResponse,
  created,
} from '@/lib/api/responses';
import { trackActivity } from '@/lib/background-jobs/activity-registry';
import { CharacterArchivedError } from '@/lib/database/repositories/characters.repository';
import { validateImageFile } from '@/lib/images-v2';
import { convertToWebP } from '@/lib/files/webp-conversion';
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
  saveImageToAlbum,
  SaveImageToAlbumError,
  SaveImageRequestSchema,
} from '@/lib/photos/save-image-to-album';
import { savedImageResponse, saveImageErrorResponse } from '@/lib/photos/save-image-response';
import { listAllPhotoAlbumOptions } from '@/lib/photos/photo-album-options';
import { getArchivedCharacterVaultMountPointIds } from '@/lib/mount-index/character-vault';
import {
  NoWardrobeImageProfileError,
  WardrobeImageGenerationError,
  generateWardrobeItemImage,
} from '@/lib/wardrobe/item-image-generation';

type Params = { itemId: string };

const LOG_TAG = '[Wardrobe Images v1]';

const containerQuerySchema = z
  .object({
    scope: z.enum(['character', 'project', 'group', 'general']),
    id: z.string().min(1).optional(),
  })
  .refine((q) => q.scope === 'general' || !!q.id, { message: 'id is required for this scope' });

const generateBodySchema = z.object({
  imageProfileId: z.string().min(1).nullable().optional(),
});

const fileIdBodySchema = z.object({
  fileId: z.string().min(1, 'fileId is required'),
});

const uploadKindSchema = z.enum(['uploaded', 'imported']).default('uploaded');

type ContainerQuery = z.infer<typeof containerQuerySchema>;

function readContainerQuery(req: NextRequest): { ok: true; query: ContainerQuery } | { ok: false; message: string } {
  const sp = req.nextUrl.searchParams;
  const parsed = containerQuerySchema.safeParse({
    scope: sp.get('scope') ?? undefined,
    id: sp.get('id') ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  return { ok: true, query: parsed.data };
}

/**
 * Resolve the container from the query and find the item in it. Answers the
 * 400 / 404 the caller should return when that fails.
 */
async function findHome(
  req: NextRequest,
  { user, repos }: RequestContext,
  itemId: string,
): Promise<{ ok: true; home: WardrobeItemHome; query: ContainerQuery } | { ok: false; response: NextResponse }> {
  const q = readContainerQuery(req);
  if (!q.ok) return { ok: false, response: badRequest(q.message) };

  const home = await resolveWardrobeItemHome(repos, user.id, q.query.scope, q.query.id ?? null, itemId);
  if (!home) return { ok: false, response: notFound('Wardrobe item') };
  return { ok: true, home, query: q.query };
}

/** The shared error mapping for every write action. */
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

// GET — the item's pictures, newest first, and which is current
async function handleList(req: NextRequest, ctx: RequestContext, { itemId }: Params) {
  const found = await findHome(req, ctx, itemId);
  if (!found.ok) return found.response;

  const images = await listWardrobeItemImages(ctx.repos, itemId);
  const ids = new Set(images.map((f) => f.id));
  const current = found.home.item.imageFileId && ids.has(found.home.item.imageFileId)
    ? found.home.item.imageFileId
    : null;

  logger.debug(`${LOG_TAG} Listed wardrobe item images`, {
    itemId,
    scope: found.query.scope,
    count: images.length,
    current,
  });
  return successResponse({ current, images: images.map(toWardrobeImageSummary) });
}

// POST ?action=generate
async function handleGenerate(req: NextRequest, ctx: RequestContext, { itemId }: Params) {
  const found = await findHome(req, ctx, itemId);
  if (!found.ok) return found.response;

  let body: z.infer<typeof generateBodySchema> = {};
  const text = await req.text();
  if (text.trim()) {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return badRequest('Invalid JSON body');
    }
    const parsed = generateBodySchema.safeParse(json);
    if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '));
    body = parsed.data;
  }

  const meta = { itemId, scope: found.query.scope, containerId: found.query.id ?? null };
  try {
    const result = await trackActivity('image', () =>
      generateWardrobeItemImage(ctx.repos, {
        userId: ctx.user.id,
        home: found.home,
        containerId: found.query.id ?? null,
        imageProfileId: body.imageProfileId ?? null,
      }),
    );
    const file = await ctx.repos.files.findById(result.fileId);
    return created({
      image: file ? toWardrobeImageSummary(file) : { fileId: result.fileId, url: result.url },
      current: result.fileId,
      prompt: result.prompt,
      subject: result.subject,
      profile: result.profile,
      rerouted: result.rerouted,
      trail: result.trail,
    });
  } catch (error) {
    if (error instanceof NoWardrobeImageProfileError) {
      return badRequest(error.message);
    }
    if (error instanceof WardrobeImageGenerationError) {
      return errorResponse(
        error.refused
          ? 'The image provider declined to draw this garment'
          : `Image generation failed: ${error.message}`,
        // 422 is a content refusal; anything else (auth, rate limit, timeout,
        // an empty answer) is the provider failing, and says so.
        error.refused ? 422 : 502,
        { trail: error.trail, refused: error.refused },
      );
    }
    return mapWriteError(error, meta);
  }
}

// POST ?action=upload — multipart `file`, optional `kind` (uploaded | imported)
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
  const kindParsed = uploadKindSchema.safeParse(form.get('kind') ?? undefined);
  if (!kindParsed.success) return badRequest('kind must be "uploaded" or "imported"');

  const meta = { itemId, scope: found.query.scope, kind: kindParsed.data };
  try {
    const converted = await convertToWebP(Buffer.from(await file.arrayBuffer()), file.type, file.name);
    const { file: stored } = await addWardrobeItemImage(ctx.repos, found.home, {
      userId: ctx.user.id,
      kind: kindParsed.data,
      content: converted.buffer,
      contentType: converted.mimeType,
      width: converted.width ?? null,
      height: converted.height ?? null,
    });
    logger.info(`${LOG_TAG} Uploaded wardrobe item image`, { ...meta, fileId: stored.id, bytes: stored.size });
    return created({ image: toWardrobeImageSummary(stored), current: stored.id });
  } catch (error) {
    return mapWriteError(error, meta);
  }
}

// POST ?action=link-image — body { fileId }: give the item a copy-by-link of
// another stored picture (Import from image's photograph, uploaded once).
async function handleLinkImage(req: NextRequest, ctx: RequestContext, { itemId }: Params) {
  const found = await findHome(req, ctx, itemId);
  if (!found.ok) return found.response;
  const meta = { itemId, scope: found.query.scope };
  try {
    const { fileId } = fileIdBodySchema.parse(await req.json());
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
}

// POST ?action=set-current
async function handleSetCurrent(req: NextRequest, ctx: RequestContext, { itemId }: Params) {
  const found = await findHome(req, ctx, itemId);
  if (!found.ok) return found.response;
  const meta = { itemId, scope: found.query.scope };
  try {
    const { fileId } = fileIdBodySchema.parse(await req.json());
    const current = await setCurrentWardrobeItemImage(ctx.repos, found.home, fileId);
    logger.info(`${LOG_TAG} Set current wardrobe item image`, { ...meta, fileId });
    return successResponse({ current });
  } catch (error) {
    return mapWriteError(error, meta);
  }
}

// POST ?action=delete-image
async function handleDeleteImage(req: NextRequest, ctx: RequestContext, { itemId }: Params) {
  const found = await findHome(req, ctx, itemId);
  if (!found.ok) return found.response;
  const meta = { itemId, scope: found.query.scope };
  try {
    const { fileId } = fileIdBodySchema.parse(await req.json());
    const current = await deleteWardrobeItemImage(ctx.repos, found.home, fileId);
    logger.info(`${LOG_TAG} Deleted wardrobe item image`, { ...meta, fileId, current });
    return successResponse({ current });
  } catch (error) {
    return mapWriteError(error, meta);
  }
}

// GET ?action=save-targets — every store the viewer's Save may file a copy in
async function handleSaveTargets(req: NextRequest, ctx: RequestContext, { itemId }: Params) {
  const found = await findHome(req, ctx, itemId);
  if (!found.ok) return found.response;
  const albums = await listAllPhotoAlbumOptions(ctx.repos);
  logger.debug(`${LOG_TAG} Listed save targets`, { itemId, scope: found.query.scope, count: albums.length });
  return successResponse({ albums });
}

// POST ?action=save-to-store — file a copy of one of the item's pictures in a store's photos/
async function handleSaveToStore(req: NextRequest, ctx: RequestContext, { itemId }: Params) {
  const found = await findHome(req, ctx, itemId);
  if (!found.ok) return found.response;

  const parsed = SaveImageRequestSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '));
  const { fileId, mountPointId, caption, tags } = parsed.data;
  const meta = { itemId, scope: found.query.scope, fileId, mountPointId };

  // The guard: only this item's own pictures leave through this door.
  const images = await listWardrobeItemImages(ctx.repos, itemId);
  if (!images.some((f) => f.id === fileId)) {
    logger.info(`${LOG_TAG} Refused to save a picture that is not the item's`, meta);
    return badRequest('That picture does not belong to this wardrobe item');
  }
  // An archived character's vault is a tombstone; nothing is filed into it.
  if ((await getArchivedCharacterVaultMountPointIds()).includes(mountPointId)) {
    logger.info(`${LOG_TAG} Refused to save into an archived character's vault`, meta);
    return conflict("That store belongs to an archived character and cannot be written to");
  }

  try {
    const saved = await saveImageToAlbum({
      mountPointId,
      fileId,
      caption: caption ?? found.home.item.title,
      tags: tags ?? [],
      attribution: { name: ctx.user.name ?? 'Quilltap', id: ctx.user.id ?? null, role: 'user' },
    });
    logger.info(`${LOG_TAG} Saved wardrobe picture to a store`, {
      ...meta,
      relativePath: saved.relativePath,
      linkId: saved.linkId,
    });
    return savedImageResponse(saved);
  } catch (error) {
    if (error instanceof SaveImageToAlbumError) {
      logger.info(`${LOG_TAG} Save to store rejected`, { ...meta, code: error.code, message: error.message });
      return saveImageErrorResponse(error);
    }
    throw error;
  }
}

export const GET = createContextParamsHandler<Params>(
  withActionDispatch<Params>({ 'save-targets': handleSaveTargets }, handleList),
);

// No default verb: a bare POST is a 400 naming the actions.
export const POST = createContextParamsHandler<Params>(
  withActionDispatch<Params>({
    generate: handleGenerate,
    upload: handleUpload,
    'link-image': handleLinkImage,
    'set-current': handleSetCurrent,
    'delete-image': handleDeleteImage,
    'save-to-store': handleSaveToStore,
  }),
);
