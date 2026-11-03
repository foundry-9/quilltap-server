/**
 * Wardrobe route factory — one implementation of the wardrobe item endpoints
 * for all four tiers.
 *
 *   - `/api/v1/characters/[id]/wardrobe` (+ `/[itemId]`) — a character's vault
 *   - `/api/v1/groups/[id]/wardrobe`     (+ `/[itemId]`) — a group's store
 *   - `/api/v1/projects/[id]/wardrobe`   (+ `/[itemId]`) — a project's store
 *   - `/api/v1/wardrobe`                 (+ `/[itemId]`) — Quilltap General
 *
 * Every tier is a location (`resolveWardrobeLocation`), so the handler bodies
 * are written once: list / create (each with `?action=instructions`), the
 * folder actions (`GET ?action=folders`; `POST ?action=create-folder`,
 * `rename-folder`, `delete-folder`, `move-items`, `copy-items`), `POST
 * ?action=duplicate`, and get (with `?action=wear-history`) / update /
 * delete. Each route file is a config. The config shape, the per-tier labels,
 * the resolver, the read probe, `?action=folders` and the error mapping are
 * the shared item-route preamble (`lib/mount-index/item-folder-routes.ts`),
 * which the Inventory's factory uses too. Rules that hold everywhere:
 *
 *   - an item read or written is serialized the same way — `origin` and
 *     `wear` attached — on GET, POST and PUT (`serializeWardrobeItems`);
 *   - a component cycle is a 400, and so is a folder path that breaks the
 *     rules or a move naming an item filed elsewhere; a missing folder is a
 *     404 and a folder collision a 409;
 *   - a PUT checks the item exists before it checks the picture choice;
 *   - a character must be the requesting user's (the location checks);
 *   - a write to an archived character's vault is a 409;
 *   - no GET provisions a store: a project or group with no store yet, or an
 *     unprovisioned General, lists as empty (`mountPointId: null`).
 *
 * The character collection GET also answers `?scope=group`: the group tier of
 * that character's wearable pool, each item tagged with its group.
 *
 * @module lib/wardrobe/routes/wardrobe-route-factory
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler, withActionDispatch } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/context';
import { logger } from '@/lib/logger';
import { badRequest, conflict, created, notFound, successResponse } from '@/lib/api/responses';
import { readIncludeArchived } from '@/lib/api/query-params';
import { CharacterArchivedError } from '@/lib/database/repositories/characters.repository';
import { WardrobeComponentCycleError } from '@/lib/database/repositories/vault-overlay/wardrobe-writes';
import { groupMountsFor, groupOriginMap } from '@/lib/mount-index/reach';
import {
  copyWardrobeItemsSchema,
  createWardrobeSchema,
  duplicateWardrobeItemSchema,
  wardrobeFolderPathSchema,
  moveWardrobeItemsSchema,
  renameWardrobeFolderSchema,
  updateWardrobeSchema,
} from '@/lib/schemas/wardrobe.types';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';
import {
  componentLookupFor,
  createItem,
  updateItem,
  WARDROBE_FOLDER_KIND,
} from '@/lib/wardrobe/item-mutations';
import { fileItemsToFolder, FolderFilingRequestError } from '@/lib/wardrobe/folder-filing';
import {
  itemRoutePreamble,
  type ItemErrorKind,
  type ItemRouteConfig,
  type ItemRouteKind,
} from '@/lib/mount-index/item-folder-routes';
import { draftFromItem, draftToPayload } from '@/lib/wardrobe/item-draft';
import { nextCopyTitle } from '@/lib/wardrobe/next-copy-title';
import { cleanupEquippedRefs, cleanupItemImages, imageChoiceError } from '@/lib/wardrobe/item-route-steps';
import {
  resolveWardrobeLocation,
  type WardrobeLocation,
  type WardrobeScope,
} from '@/lib/wardrobe/location';
import { withOrigin, type WardrobeOrigin } from '@/lib/wardrobe/wardrobe-container';
import { attachWear, buildWearHistoryPayload } from '@/lib/wardrobe/wear-history';
import {
  handleReadWardrobeInstructions,
  handleWriteWardrobeInstructions,
  parseWardrobeInstructionsBody,
} from '@/lib/wardrobe/wardrobe-instructions-handlers';

type Params = Record<string, string>;
type Repos = RequestContext['repos'];

/** A wardrobe route file's config: the shared item-route shape. */
export type WardrobeRouteConfig<P extends Params> = ItemRouteConfig<P, WardrobeScope>;

/** The wardrobe's own refusals, beside the folder and tombstone ones every kind shares. */
export const WARDROBE_ITEM_ERRORS: ItemErrorKind = {
  noun: 'wardrobe',
  refusals: (error) => {
    if (error instanceof WardrobeComponentCycleError) return badRequest(error.message);
    if (error instanceof FolderFilingRequestError) return badRequest(error.message);
    return null;
  },
};

/** What the shared preamble needs to know about the wardrobe. */
const WARDROBE_ROUTE_KIND: ItemRouteKind<WardrobeLocation> = {
  folderKind: WARDROBE_FOLDER_KIND,
  itemLabels: {
    character: 'Wardrobe item',
    group: 'Group wardrobe item',
    project: 'Project wardrobe item',
    general: 'Archetype wardrobe item',
  },
  resolve: resolveWardrobeLocation,
  errors: WARDROBE_ITEM_ERRORS,
  folderSchemas: { path: wardrobeFolderPathSchema, rename: renameWardrobeFolderSchema },
};

/** Attach the origin and wear tally every wardrobe response carries. */
export async function serializeWardrobeItems(
  items: readonly WardrobeItem[],
  origin: WardrobeOrigin,
  repos: Repos,
) {
  return attachWear(withOrigin(items, origin), repos);
}

async function serializeOne(item: WardrobeItem, origin: WardrobeOrigin, repos: Repos) {
  const [serialized] = await serializeWardrobeItems([item], origin, repos);
  return serialized;
}

// ============================================================================
// Collection — GET (list) / POST (create), each with ?action=instructions
// ============================================================================

export function createWardrobeCollectionHandlers<P extends Params>(config: WardrobeRouteConfig<P>) {
  const { scope, logTag, logIdKey } = config;
  const preamble = itemRoutePreamble(WARDROBE_ROUTE_KIND, config);
  const { labels, resolveLocation, probe, errorResponse } = preamble;

  async function handleGetInstructions(_req: NextRequest, ctx: RequestContext, params: P) {
    // A read probe: a tier with no store yet simply has no instructions.
    const probed = await probe(ctx, params);
    if (!probed.ok) return probed.response;
    const { location } = probed;
    const mountPointId = location?.mountPointId ?? null;
    return handleReadWardrobeInstructions(mountPointId, ({ present }) => {
      logger.debug(`${logTag} Read dressing instructions`, {
        [logIdKey]: location?.id ?? null,
        mountPointId,
        present,
        context: 'wardrobe',
      });
    });
  }

  async function handlePostInstructions(req: NextRequest, ctx: RequestContext, params: P) {
    const body = await parseWardrobeInstructionsBody(req);
    const resolved = await resolveLocation(ctx, params, true);
    if (!resolved.ok) {
      // Clearing instructions that can't exist yet is a harmless no-op.
      if (body.cleared && scope === 'general') return successResponse({ instructions: null });
      return resolved.response;
    }
    let mountPointId: string;
    try {
      mountPointId = await resolved.location.writableMountPointId();
    } catch (error) {
      if (error instanceof CharacterArchivedError) {
        return conflict('Character is archived; dressing instructions cannot be edited');
      }
      throw error;
    }
    return handleWriteWardrobeInstructions(mountPointId, body, ({ cleared }) => {
      logger.info(`${logTag} Dressing instructions updated`, {
        [logIdKey]: resolved.location.id,
        userId: ctx.user.id,
        mountPointId,
        cleared,
        context: 'wardrobe',
      });
    });
  }

  // Folders — `GET ?action=folders` and the folder writes are the shared
  // preamble's; item filing below carries an outfit's components.
  const { getFolders: handleGetFolders, folderActions } = preamble;

  /**
   * `move-items` / `copy-items`: file items into one folder of this tier, an
   * outfit's same-wardrobe components brought along as `components` says.
   */
  async function handleFileItems(
    action: 'move' | 'copy',
    body: { itemIds: string[]; folder: string; components?: 'move' | 'copy' | 'none' },
    ctx: RequestContext,
    params: P,
  ) {
    const resolved = await resolveLocation(ctx, params, false);
    if (!resolved.ok) return resolved.response;
    const { location } = resolved;
    let result: Awaited<ReturnType<typeof fileItemsToFolder>>;
    try {
      result = await fileItemsToFolder(ctx.repos, ctx.user.id, location, { action, ...body });
    } catch (error) {
      return errorResponse(error);
    }
    logger.info(`${logTag} ${action === 'move' ? 'Moved' : 'Copied'} wardrobe items to folder`, {
      [logIdKey]: location.id,
      userId: ctx.user.id,
      mountPointId: location.mountPointId,
      folder: body.folder,
      count: result.items.length,
      components: body.components ?? 'none',
      componentsCarried: result.componentsCarried,
      context: 'wardrobe',
    });
    return successResponse({
      items: await serializeWardrobeItems(result.items, location.origin, ctx.repos),
      componentsCarried: result.componentsCarried,
    });
  }

  async function handleMoveItems(req: NextRequest, ctx: RequestContext, params: P) {
    return handleFileItems('move', moveWardrobeItemsSchema.parse(await req.json()), ctx, params);
  }

  async function handleCopyItems(req: NextRequest, ctx: RequestContext, params: P) {
    return handleFileItems('copy', copyWardrobeItemsSchema.parse(await req.json()), ctx, params);
  }

  /** The character tier's `?scope=group`: the group tier, each item tagged with its group. */
  async function listGroupTier(req: NextRequest, ctx: RequestContext, location: WardrobeLocation) {
    const characterId = location.characterId as string;
    const groups = await groupMountsFor(characterId);
    const originByMount: Map<string, WardrobeOrigin> = groupOriginMap(groups);
    // Strongest first in the tier (membership order, first group claims); the
    // repository shadows later-over-earlier, so read it reversed.
    const items = await ctx.repos.wardrobe.readSharedTiers(
      Array.from(originByMount.keys()).reverse(),
      readIncludeArchived(req),
      (mp) => originByMount.get(mp)!,
    );
    const wardrobeItems = await attachWear(items, ctx.repos);
    logger.debug(`${logTag} Group-tier wardrobe read`, {
      characterId,
      groupCount: groups.length,
      groupMountCount: originByMount.size,
      itemCount: wardrobeItems.length,
      context: 'wardrobe',
    });
    return successResponse({ wardrobeItems });
  }

  /**
   * `{ itemId }`: a copy of one of this tier's items beside the original — the
   * same folder, every editable field, titled by `nextCopyTitle` against the
   * tier's titles (archived ones included). A composite's component ids are
   * copied verbatim; the members are not cloned. Goes through `createItem`.
   */
  async function handleDuplicate(req: NextRequest, ctx: RequestContext, params: P) {
    const { itemId } = duplicateWardrobeItemSchema.parse(await req.json());
    const resolved = await resolveLocation(ctx, params, false);
    if (!resolved.ok) return resolved.response;
    const { location } = resolved;
    const current = await location.findItem(itemId);
    if (!current) return notFound(labels.item);

    const title = nextCopyTitle(current.title, (await location.readItems(true)).map((i) => i.title));
    const body = createWardrobeSchema.parse(draftToPayload({ ...draftFromItem(current), title }));
    logger.debug(`${logTag} Duplicating wardrobe item`, {
      [logIdKey]: location.id,
      itemId,
      title,
      folder: body.folder ?? '',
      context: 'wardrobe',
    });

    let stored: WardrobeItem;
    try {
      const lookup = (body.componentItemIds?.length ?? 0) > 0
        ? await componentLookupFor(ctx.repos, location)
        : undefined;
      stored = await createItem(location, body, { lookup });
    } catch (error) {
      return errorResponse(error);
    }

    logger.info(`${logTag} Duplicated wardrobe item`, {
      [logIdKey]: location.id,
      userId: ctx.user.id,
      mountPointId: location.mountPointId,
      itemId,
      copyId: stored.id,
      title: stored.title,
      context: 'wardrobe',
    });
    return created({ wardrobeItem: await serializeOne(stored, location.origin, ctx.repos) });
  }

  const GET = createContextParamsHandler<P>(
    withActionDispatch<P>({ instructions: handleGetInstructions, folders: handleGetFolders }, async (req, ctx, params) => {
      // A read probe never provisions: a tier with no store yet lists as empty.
      const probed = await probe(ctx, params);
      if (!probed.ok) return probed.response;
      const { location } = probed;
      if (!location) return successResponse({ mountPointId: null, wardrobeItems: [] });
      if (scope === 'character' && new URL(req.url).searchParams.get('scope') === 'group') {
        return listGroupTier(req, ctx, location);
      }
      const wardrobeItems = await serializeWardrobeItems(
        await location.readItems(readIncludeArchived(req)),
        location.origin,
        ctx.repos,
      );
      logger.debug(`${logTag} Listed wardrobe items`, {
        [logIdKey]: location.id,
        mountPointId: location.mountPointId,
        count: wardrobeItems.length,
        context: 'wardrobe',
      });
      return successResponse({ mountPointId: location.mountPointId, wardrobeItems });
    }),
  );

  const POST = createContextParamsHandler<P>(
    withActionDispatch<P>({
      instructions: handlePostInstructions,
      ...folderActions,
      'move-items': handleMoveItems,
      'copy-items': handleCopyItems,
      duplicate: handleDuplicate,
    }, async (req, ctx, params) => {
      // Parse before resolving: an invalid body must never provision a store.
      const body = createWardrobeSchema.parse(await req.json());
      const resolved = await resolveLocation(ctx, params, true);
      if (!resolved.ok) return resolved.response;
      const { location } = resolved;

      let stored: WardrobeItem;
      try {
        const lookup = (body.componentItemIds?.length ?? 0) > 0
          ? await componentLookupFor(ctx.repos, location)
          : undefined;
        stored = await createItem(location, body, { lookup });
      } catch (error) {
        return errorResponse(error);
      }

      logger.info(`${logTag} Created wardrobe item`, {
        [logIdKey]: location.id,
        userId: ctx.user.id,
        mountPointId: location.mountPointId,
        itemId: stored.id,
        title: stored.title,
        context: 'wardrobe',
      });
      return created({ wardrobeItem: await serializeOne(stored, location.origin, ctx.repos) });
    }),
  );

  return { GET, POST };
}

// ============================================================================
// Item — GET (with ?action=wear-history) / PUT / DELETE
// ============================================================================

export function createWardrobeItemHandlers<P extends Params & { itemId: string }>(
  config: WardrobeRouteConfig<P>,
) {
  const { logTag, logIdKey } = config;
  const { labels, resolveLocation, errorResponse } = itemRoutePreamble(WARDROBE_ROUTE_KIND, config);

  /** The tier's location and the item in it, or the 404 to answer. */
  async function findItem(
    ctx: RequestContext,
    params: P,
  ): Promise<
    | { ok: true; location: WardrobeLocation; item: WardrobeItem }
    | { ok: false; response: NextResponse }
  > {
    const resolved = await resolveLocation(ctx, params, false);
    if (!resolved.ok) return resolved;
    const item = await resolved.location.findItem(params.itemId);
    if (!item) return { ok: false, response: notFound(labels.item) };
    return { ok: true, location: resolved.location, item };
  }

  async function handleGetWearHistory(_req: NextRequest, ctx: RequestContext, params: P) {
    const found = await findItem(ctx, params);
    if (!found.ok) return found.response;
    const payload = await buildWearHistoryPayload(params.itemId, ctx.repos);
    logger.debug(`${logTag} Read wardrobe item wear history`, {
      [logIdKey]: found.location.id,
      itemId: params.itemId,
      wearCount: payload.history.wearCount,
      context: 'wardrobe',
    });
    return successResponse(payload);
  }

  const GET = createContextParamsHandler<P>(
    withActionDispatch<P>({ 'wear-history': handleGetWearHistory }, async (_req, ctx, params) => {
      const found = await findItem(ctx, params);
      if (!found.ok) return found.response;
      return successResponse({
        wardrobeItem: await serializeOne(found.item, found.location.origin, ctx.repos),
      });
    }),
  );

  const PUT = createContextParamsHandler<P>(async (req, ctx, params) => {
    const found = await findItem(ctx, params);
    if (!found.ok) return found.response;
    const { location, item: current } = found;

    const { archived, ...fields } = updateWardrobeSchema.parse(await req.json());

    const imageError = await imageChoiceError(ctx.repos, current.id, fields.imageFileId);
    if (imageError) return badRequest(imageError);

    let item: WardrobeItem | null;
    try {
      // Only a composite whose composition is being edited needs its parts.
      const composite = (fields.componentItemIds ?? current.componentItemIds).length > 0;
      const touchesComposition = fields.componentItemIds !== undefined || fields.types !== undefined;
      const lookup = composite && touchesComposition ? await componentLookupFor(ctx.repos, location) : undefined;
      item = await updateItem(location, current, { ...fields, archived }, { lookup });
    } catch (error) {
      return errorResponse(error);
    }
    if (!item) return notFound(labels.item);

    logger.info(`${logTag} Updated wardrobe item`, {
      [logIdKey]: location.id,
      userId: ctx.user.id,
      mountPointId: location.mountPointId,
      itemId: item.id,
      context: 'wardrobe',
      ...(archived !== undefined && { archivedAt: item.archivedAt ?? null }),
    });
    return successResponse({ wardrobeItem: await serializeOne(item, location.origin, ctx.repos) });
  });

  const DELETE = createContextParamsHandler<P>(async (_req, ctx, params) => {
    const found = await findItem(ctx, params);
    if (!found.ok) return found.response;
    const { location } = found;
    const meta = { [logIdKey]: location.id, itemId: params.itemId, context: 'wardrobe' };

    // Refuse an archived character's vault before touching any chat.
    try {
      await location.writableMountPointId();
    } catch (error) {
      return errorResponse(error);
    }

    await cleanupEquippedRefs(ctx.repos, params.itemId, logTag, meta);

    let success: boolean;
    try {
      success = await location.delete(params.itemId);
    } catch (error) {
      return errorResponse(error);
    }
    if (!success) return notFound(labels.item);

    await cleanupItemImages(ctx.repos, params.itemId, logTag, { ...meta, mountPointId: location.mountPointId });

    logger.info(`${logTag} Deleted wardrobe item`, { ...meta, mountPointId: location.mountPointId });
    return successResponse({ success: true });
  });

  return { GET, PUT, DELETE };
}
