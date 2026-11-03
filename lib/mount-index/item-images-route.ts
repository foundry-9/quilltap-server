/**
 * The item images route, stated once for every kind of tiered item (the
 * wardrobe's garments and the Inventory's objects): `createItemImagesRoute`
 * builds the `GET` / `POST` behind `/api/v1/wardrobe/[itemId]/images` and
 * `/api/v1/inventory/[itemId]/images`, each route file a kind adapter.
 *
 * GET  …/[itemId]/images?scope=<scope>&id=<containerId>  → { current, images }
 * GET  …?action=save-targets                             → { albums }
 * POST …?action=generate      body { imageProfileId? }   → { image, current, prompt, profile, rerouted, trail, … }
 * POST …?action=upload        multipart `file` (+ `kind`: uploaded | imported) → { image, current }
 * POST …?action=set-current   body { fileId }            → { current }
 * POST …?action=delete-image  body { fileId }            → { current }
 * POST …?action=save-to-store body { fileId, mountPointId, caption?, tags? }
 *
 * plus any `extraPostActions` the kind declares (the wardrobe's `link-image`).
 *
 * `scope` ∈ character | project | group | general; `id` is required for all
 * but general. The item must live in the named container (404 otherwise).
 * What differs between kinds is the adapter's: how a home is found, which
 * pictures a list shows (the Inventory's instance falls through to its
 * archetype's, marked `inherited`), what a generation answers, the 404 and
 * refusal wording, and how a write's refusal maps (`errorResponse`, which
 * rethrows anything it does not own). Generation is synchronous and wrapped in
 * `trackActivity('image', …)` so the toolbar's Img chip lights for the call.
 *
 * `save-to-store` backs the full-screen viewer's Save: the picture must be one
 * the item shows, an archived character's vault is refused (409), and a copy
 * is filed through the shared `saveImageToAlbum` service. The item itself is
 * not changed, so an archived character's item may still be copied *out*.
 *
 * Server-only.
 *
 * @module lib/mount-index/item-images-route
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
import { saveImageToAlbum, SaveImageToAlbumError, SaveImageRequestSchema } from '@/lib/photos/save-image-to-album';
import { savedImageResponse, saveImageErrorResponse } from '@/lib/photos/save-image-response';
import { listAllPhotoAlbumOptions } from '@/lib/photos/photo-album-options';
import { getArchivedCharacterVaultMountPointIds } from '@/lib/mount-index/character-vault';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { FileEntry } from '@/lib/schemas/file.types';

type Params = { itemId: string };

export const ItemImagesScopeSchema = z.enum(['character', 'project', 'group', 'general']);
export type ItemImagesScope = z.infer<typeof ItemImagesScopeSchema>;

const containerQuerySchema = z
  .object({ scope: ItemImagesScopeSchema, id: z.string().min(1).optional() })
  .refine((q) => q.scope === 'general' || !!q.id, { message: 'id is required for this scope' });
const generateBodySchema = z.object({ imageProfileId: z.string().min(1).nullable().optional() });
export const itemImageFileIdBodySchema = z.object({ fileId: z.string().min(1, 'fileId is required') });
const uploadKindSchema = z.enum(['uploaded', 'imported']).default('uploaded');

export type ItemImagesContainer = z.infer<typeof containerQuerySchema>;

/** A home found in its container: the item, and the container the query named. */
export interface FoundItemHome<H> {
  home: H;
  query: ItemImagesContainer;
}

/** A kind-specific POST action, run after the home is found. */
export type ItemImagesAction<H> = (
  req: NextRequest,
  ctx: RequestContext,
  found: FoundItemHome<H>,
  itemId: string,
) => Promise<NextResponse>;

/** A constructor the route tests with `instanceof`. */
type ErrorClass<E extends Error = Error> = abstract new (...args: never[]) => E;

/** Everything one kind tells the shared images route. */
export interface ItemImagesKind<H extends { item: { imageFileId?: string | null } }> {
  /** Log-message prefix, e.g. `'[Wardrobe Images v1]'`. */
  logTag: string;
  /** Log `context`, e.g. `'wardrobe'`. */
  context: string;
  messages: {
    /** The 404 for an item not in the named container, e.g. `'Wardrobe item'`. */
    itemNotFound: string;
    /** The 400 for a save-to-store of a picture the item does not show. */
    foreignPicture: string;
    /** The 400 for a generate body that is not JSON. */
    invalidJson: string;
    /** What the provider declined to draw, e.g. `'this garment'`. */
    refusedSubject: string;
  };
  resolveHome: (
    repos: RepositoryContainer,
    userId: string,
    scope: ItemImagesScope,
    id: string | null,
    itemId: string,
  ) => Promise<H | null>;
  /** The pictures a list shows (and the only ones save-to-store lets out), newest first. */
  listImages: (repos: RepositoryContainer, home: H, itemId: string) => Promise<Array<{ fileId: string }>>;
  /** The default caption of a saved copy. */
  captionOf: (home: H) => string;
  /** One stored picture as the wire carries it. */
  summarize: (file: FileEntry) => unknown;
  /** Draw a picture; the response's fields beyond `image` and `current` go in `extras`. */
  generate: (
    repos: RepositoryContainer,
    args: { userId: string; home: H; containerId: string | null; imageProfileId: string | null },
  ) => Promise<{ fileId: string; url?: string; extras: Record<string, unknown> }>;
  /** No image profile to draw with (400). */
  noProfileError: ErrorClass;
  /** The provider failed (502) or refused (422), with its trail. */
  generationError: ErrorClass<Error & { trail: unknown; refused: boolean }>;
  addImage: (
    repos: RepositoryContainer,
    home: H,
    input: {
      userId: string;
      kind: 'uploaded' | 'imported';
      content: Buffer;
      contentType: string;
      width: number | null;
      height: number | null;
    },
  ) => Promise<{ file: FileEntry }>;
  setCurrent: (repos: RepositoryContainer, home: H, fileId: string) => Promise<string | null>;
  deleteImage: (repos: RepositoryContainer, home: H, fileId: string) => Promise<string | null>;
  /** Map a write's refusal to its response; rethrow anything the kind does not own. */
  errorResponse: (error: unknown, meta: Record<string, unknown>) => NextResponse;
  /** Kind-only POST actions (the wardrobe's `link-image`). */
  extraPostActions?: Record<string, ItemImagesAction<H>>;
}

/** Build the images route for one kind. */
export function createItemImagesRoute<H extends { item: { imageFileId?: string | null } }>(kind: ItemImagesKind<H>) {
  const { logTag, context, messages } = kind;

  /**
   * Resolve the container from the query and find the item in it, or the
   * 400 / 404 to answer.
   */
  async function findHome(
    req: NextRequest,
    { user, repos }: RequestContext,
    itemId: string,
  ): Promise<{ ok: true; found: FoundItemHome<H> } | { ok: false; response: NextResponse }> {
    const sp = req.nextUrl.searchParams;
    const parsed = containerQuerySchema.safeParse({ scope: sp.get('scope') ?? undefined, id: sp.get('id') ?? undefined });
    if (!parsed.success) {
      return { ok: false, response: badRequest(parsed.error.issues.map((i) => i.message).join('; ')) };
    }
    const home = await kind.resolveHome(repos, user.id, parsed.data.scope, parsed.data.id ?? null, itemId);
    if (!home) {
      logger.debug(`${logTag} Item not in the named container`, { itemId, scope: parsed.data.scope, context });
      return { ok: false, response: notFound(messages.itemNotFound) };
    }
    return { ok: true, found: { home, query: parsed.data } };
  }

  /** Wrap a handler that needs the home: find it first, answer its 400/404 otherwise. */
  function withHome(action: ItemImagesAction<H>) {
    return async (req: NextRequest, ctx: RequestContext, { itemId }: Params): Promise<NextResponse> => {
      const located = await findHome(req, ctx, itemId);
      if (!located.ok) return located.response;
      return action(req, ctx, located.found, itemId);
    };
  }

  const metaOf = (itemId: string, found: FoundItemHome<H>, extra: Record<string, unknown> = {}) => ({
    itemId,
    scope: found.query.scope,
    ...extra,
    context,
  });

  // GET — the item's pictures, newest first, and which is current
  const handleList: ItemImagesAction<H> = async (_req, ctx, found, itemId) => {
    const images = await kind.listImages(ctx.repos, found.home, itemId);
    const ids = new Set(images.map((image) => image.fileId));
    const wanted = found.home.item.imageFileId ?? null;
    const current = wanted && ids.has(wanted) ? wanted : null;
    logger.debug(`${logTag} Listed item images`, metaOf(itemId, found, { count: images.length, current }));
    return successResponse({ current, images });
  };

  // POST ?action=generate — an empty body means "the default profile"; a
  // malformed one is the caller's error (400), never a 500.
  const handleGenerate: ItemImagesAction<H> = async (req, ctx, found, itemId) => {
    const text = await req.text();
    let raw: unknown = {};
    if (text.trim()) {
      try {
        raw = JSON.parse(text);
      } catch {
        logger.debug(`${logTag} Generate body is not valid JSON`, metaOf(itemId, found));
        return badRequest(messages.invalidJson);
      }
    }
    const parsed = generateBodySchema.safeParse(raw);
    if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '));

    const containerId = found.query.id ?? null;
    const meta = metaOf(itemId, found, { containerId });
    try {
      const result = await trackActivity('image', () =>
        kind.generate(ctx.repos, {
          userId: ctx.user.id,
          home: found.home,
          containerId,
          imageProfileId: parsed.data.imageProfileId ?? null,
        }),
      );
      const file = await ctx.repos.files.findById(result.fileId);
      logger.debug(`${logTag} Generated item image`, { ...meta, fileId: result.fileId });
      return created({
        image: file ? kind.summarize(file) : { fileId: result.fileId, url: result.url },
        current: result.fileId,
        ...result.extras,
      });
    } catch (error) {
      if (error instanceof kind.noProfileError) return badRequest(error.message);
      if (error instanceof kind.generationError) {
        logger.debug(`${logTag} Generation failed`, { ...meta, refused: error.refused });
        return errorResponse(
          error.refused
            ? `The image provider declined to draw ${messages.refusedSubject}`
            : `Image generation failed: ${error.message}`,
          // 422 is a content refusal; anything else (auth, rate limit, timeout,
          // an empty answer) is the provider failing, and says so.
          error.refused ? 422 : 502,
          { trail: error.trail, refused: error.refused },
        );
      }
      return kind.errorResponse(error, meta);
    }
  };

  // POST ?action=upload — multipart `file`, optional `kind` (uploaded | imported)
  const handleUpload: ItemImagesAction<H> = async (req, ctx, found, itemId) => {
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
    const uploadKind = uploadKindSchema.safeParse(form.get('kind') ?? undefined);
    if (!uploadKind.success) return badRequest('kind must be "uploaded" or "imported"');

    const meta = metaOf(itemId, found, { kind: uploadKind.data });
    try {
      const converted = await convertToWebP(Buffer.from(await file.arrayBuffer()), file.type, file.name);
      const { file: stored } = await kind.addImage(ctx.repos, found.home, {
        userId: ctx.user.id,
        kind: uploadKind.data,
        content: converted.buffer,
        contentType: converted.mimeType,
        width: converted.width ?? null,
        height: converted.height ?? null,
      });
      logger.info(`${logTag} Uploaded item image`, { ...meta, fileId: stored.id, bytes: stored.size });
      return created({ image: kind.summarize(stored), current: stored.id });
    } catch (error) {
      return kind.errorResponse(error, meta);
    }
  };

  // POST ?action=set-current
  const handleSetCurrent: ItemImagesAction<H> = async (req, ctx, found, itemId) => {
    const meta = metaOf(itemId, found);
    try {
      const { fileId } = itemImageFileIdBodySchema.parse(await req.json());
      const current = await kind.setCurrent(ctx.repos, found.home, fileId);
      logger.info(`${logTag} Set current item image`, { ...meta, fileId });
      return successResponse({ current });
    } catch (error) {
      return kind.errorResponse(error, meta);
    }
  };

  // POST ?action=delete-image
  const handleDeleteImage: ItemImagesAction<H> = async (req, ctx, found, itemId) => {
    const meta = metaOf(itemId, found);
    try {
      const { fileId } = itemImageFileIdBodySchema.parse(await req.json());
      const current = await kind.deleteImage(ctx.repos, found.home, fileId);
      logger.info(`${logTag} Deleted item image`, { ...meta, fileId, current });
      return successResponse({ current });
    } catch (error) {
      return kind.errorResponse(error, meta);
    }
  };

  // GET ?action=save-targets — every store the viewer's Save may file a copy in
  const handleSaveTargets: ItemImagesAction<H> = async (_req, ctx, found, itemId) => {
    const albums = await listAllPhotoAlbumOptions(ctx.repos);
    logger.debug(`${logTag} Listed save targets`, metaOf(itemId, found, { count: albums.length }));
    return successResponse({ albums });
  };

  // POST ?action=save-to-store — file a copy of one of the item's pictures in a store's photos/
  const handleSaveToStore: ItemImagesAction<H> = async (req, ctx, found, itemId) => {
    const parsed = SaveImageRequestSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return badRequest(parsed.error.issues.map((i) => i.message).join('; '));
    const { fileId, mountPointId, caption, tags } = parsed.data;
    const meta = metaOf(itemId, found, { fileId, mountPointId });

    // The guard: only the pictures this item shows leave through this door.
    const allowed = await kind.listImages(ctx.repos, found.home, itemId);
    if (!allowed.some((image) => image.fileId === fileId)) {
      logger.info(`${logTag} Refused to save a picture that is not the item's`, meta);
      return badRequest(messages.foreignPicture);
    }
    // An archived character's vault is a tombstone; nothing is filed into it.
    if ((await getArchivedCharacterVaultMountPointIds()).includes(mountPointId)) {
      logger.info(`${logTag} Refused to save into an archived character's vault`, meta);
      return conflict('That store belongs to an archived character and cannot be written to');
    }

    try {
      const saved = await saveImageToAlbum({
        mountPointId,
        fileId,
        caption: caption ?? kind.captionOf(found.home),
        tags: tags ?? [],
        attribution: { name: ctx.user.name ?? 'Quilltap', id: ctx.user.id ?? null, role: 'user' },
      });
      logger.info(`${logTag} Saved item picture to a store`, {
        ...meta,
        relativePath: saved.relativePath,
        linkId: saved.linkId,
      });
      return savedImageResponse(saved);
    } catch (error) {
      if (error instanceof SaveImageToAlbumError) {
        logger.info(`${logTag} Save to store rejected`, { ...meta, code: error.code, message: error.message });
        return saveImageErrorResponse(error);
      }
      throw error;
    }
  };

  const extra = Object.fromEntries(
    Object.entries(kind.extraPostActions ?? {}).map(([name, action]) => [name, withHome(action)]),
  );

  const GET = createContextParamsHandler<Params>(
    withActionDispatch<Params>({ 'save-targets': withHome(handleSaveTargets) }, withHome(handleList)),
  );

  // No default verb: a bare POST is a 400 naming the actions.
  const POST = createContextParamsHandler<Params>(
    withActionDispatch<Params>({
      generate: withHome(handleGenerate),
      upload: withHome(handleUpload),
      ...extra,
      'set-current': withHome(handleSetCurrent),
      'delete-image': withHome(handleDeleteImage),
      'save-to-store': withHome(handleSaveToStore),
    }),
  );

  return { GET, POST };
}
