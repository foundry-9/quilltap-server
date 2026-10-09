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
 * are written once: list / create (each with `?action=instructions`), and
 * get (with `?action=wear-history`) / update / delete. Each route file is a
 * config. Rules that hold everywhere:
 *
 *   - an item read or written is serialized the same way — `origin` and
 *     `wear` attached — on GET, POST and PUT (`serializeWardrobeItems`);
 *   - a component cycle is a 400;
 *   - a PUT checks the item exists before it checks the picture choice;
 *   - a character must be the requesting user's (the location checks);
 *   - a write to an archived character's vault is a 409.
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
import {
  badRequest,
  conflict,
  created,
  notFound,
  serverError,
  successResponse,
} from '@/lib/api/responses';
import { readIncludeArchived } from '@/lib/api/query-params';
import { CharacterArchivedError } from '@/lib/database/repositories/characters.repository';
import { WardrobeComponentCycleError } from '@/lib/database/repositories/vault-overlay/wardrobe-writes';
import { resolveGroupMountsForCharacter } from '@/lib/mount-index/tiered-mount-pool';
import { createWardrobeSchema, updateWardrobeSchema } from '@/lib/schemas/wardrobe.types';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';
import { componentLookupFor, createItem, updateItem } from '@/lib/wardrobe/item-mutations';
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

export interface WardrobeRouteConfig<P extends Params> {
  scope: WardrobeScope;
  /** The owner id from the route params; null for General. */
  paramsToId: (params: P) => string | null;
  /** Log-message prefix, e.g. `'[Projects v1]'`. */
  logTag: string;
  /** Metadata key naming the owner id in log lines, e.g. `'projectId'`. */
  logIdKey: string;
}

/** The labels each tier's 404s have always carried. */
const LABELS: Record<WardrobeScope, { owner: string; item: string }> = {
  character: { owner: 'Character', item: 'Wardrobe item' },
  group: { owner: 'Group', item: 'Group wardrobe item' },
  project: { owner: 'Project', item: 'Project wardrobe item' },
  general: { owner: 'Quilltap General', item: 'Archetype wardrobe item' },
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

/** Map the write-side refusals every tier shares; rethrow anything else. */
function writeErrorResponse(error: unknown): NextResponse {
  if (error instanceof WardrobeComponentCycleError) return badRequest(error.message);
  if (error instanceof CharacterArchivedError) {
    return conflict("An archived character's wardrobe cannot be changed");
  }
  throw error;
}

function makeResolver<P extends Params>(config: WardrobeRouteConfig<P>) {
  const labels = LABELS[config.scope];
  /**
   * Resolve the tier's location, or the response to answer. `ensure`
   * provisions a missing project/group store and folder; every handler that
   * lists, creates or writes instructions passes it.
   */
  return async function resolveLocation(
    ctx: RequestContext,
    params: P,
    ensure: boolean,
  ): Promise<{ ok: true; location: WardrobeLocation } | { ok: false; response: NextResponse }> {
    const location = await resolveWardrobeLocation(
      config.scope,
      config.paramsToId(params),
      ctx.repos,
      ctx.user.id,
      { ensure },
    );
    if (location) return { ok: true, location };
    if (config.scope === 'general') {
      return { ok: false, response: serverError('Quilltap General store is not provisioned yet') };
    }
    return { ok: false, response: notFound(labels.owner) };
  };
}

// ============================================================================
// Collection — GET (list) / POST (create), each with ?action=instructions
// ============================================================================

export function createWardrobeCollectionHandlers<P extends Params>(config: WardrobeRouteConfig<P>) {
  const { scope, logTag, logIdKey } = config;
  const resolveLocation = makeResolver(config);

  async function handleGetInstructions(req: NextRequest, ctx: RequestContext, params: P) {
    const location = await resolveWardrobeLocation(scope, config.paramsToId(params), ctx.repos, ctx.user.id, {
      ensure: scope !== 'character',
    });
    if (!location && scope !== 'general') return notFound(LABELS[scope].owner);
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

  /** The character tier's `?scope=group`: the group tier, each item tagged with its group. */
  async function listGroupTier(req: NextRequest, ctx: RequestContext, location: WardrobeLocation) {
    const characterId = location.characterId as string;
    const groups = await resolveGroupMountsForCharacter(characterId);
    const originByMount = new Map<string, WardrobeOrigin>();
    for (const { group, mountPointIds } of groups) {
      for (const mp of mountPointIds) originByMount.set(mp, { scope: 'group', id: group.id, name: group.name });
    }
    const items = await ctx.repos.wardrobe.readSharedTiers(
      Array.from(originByMount.keys()),
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

  const GET = createContextParamsHandler<P>(
    withActionDispatch<P>({ instructions: handleGetInstructions }, async (req, ctx, params) => {
      const location = await resolveWardrobeLocation(scope, config.paramsToId(params), ctx.repos, ctx.user.id, {
        ensure: scope !== 'character',
      });
      if (!location) {
        // An unprovisioned General simply has nothing in it yet.
        if (scope === 'general') return successResponse({ wardrobeItems: [] });
        return notFound(LABELS[scope].owner);
      }
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
    withActionDispatch<P>({ instructions: handlePostInstructions }, async (req, ctx, params) => {
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
        return writeErrorResponse(error);
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
  const { scope, logTag, logIdKey } = config;
  const labels = LABELS[scope];
  const resolveLocation = makeResolver(config);

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
      return writeErrorResponse(error);
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
      return writeErrorResponse(error);
    }

    await cleanupEquippedRefs(ctx.repos, params.itemId, logTag, meta);

    let success: boolean;
    try {
      success = await location.delete(params.itemId);
    } catch (error) {
      return writeErrorResponse(error);
    }
    if (!success) return notFound(labels.item);

    await cleanupItemImages(ctx.repos, params.itemId, logTag, { ...meta, mountPointId: location.mountPointId });

    logger.info(`${logTag} Deleted wardrobe item`, { ...meta, mountPointId: location.mountPointId });
    return successResponse({ success: true });
  });

  return { GET, PUT, DELETE };
}
