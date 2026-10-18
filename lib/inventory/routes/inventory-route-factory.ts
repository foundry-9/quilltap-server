/**
 * Inventory route factory — one implementation of the Inventory endpoints for
 * all four tiers, each route file a config:
 *
 *   - `/api/v1/characters/[id]/inventory` (+ `/[itemId]`) — a character's vault
 *   - `/api/v1/groups/[id]/inventory`     (+ `/[itemId]`) — a group's store
 *   - `/api/v1/projects/[id]/inventory`   (+ `/[itemId]`) — a project's store
 *   - `/api/v1/inventory`                 (+ `/[itemId]`) — Quilltap General
 *
 * Collection: `GET` lists the tier's objects resolved (`?includeArchived`;
 * the character tier's `?shared=true` lists the whole reachable pool, each
 * object tagged with its tier), `?action=folders`, `?action=archetypes` (the
 * archetypes reachable from this tier, for the instantiate picker; a
 * character takes `?projectId=` / `?chatId=` for the project tier). `POST`
 * creates; `?action=instantiate`, `create-folder`, `rename-folder`,
 * `delete-folder`, `move-items`, `copy-items`.
 *
 * Item: `GET` one resolved object, `?action=dependents`; `PUT` an edit
 * (`archived` archives), `?action=clear-override`, `?action=detach`;
 * `DELETE` (`?force=true` bakes an archetype's instances first).
 *
 * Every refusal maps through `inventoryErrorResponse` (a `409` with its
 * `code`, or a `400`); an archived character's vault answers `409`.
 *
 * @module lib/inventory/routes/inventory-route-factory
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler, withActionDispatch } from '@/lib/api/middleware';
import type { RequestContext } from '@/lib/api/middleware/context';
import { logger } from '@/lib/logger';
import { created, notFound, serverError, successResponse } from '@/lib/api/responses';
import { readIncludeArchived } from '@/lib/api/query-params';
import {
  clearInventoryOverrideSchema,
  createInventorySchema,
  fileInventoryItemsSchema,
  instantiateInventorySchema,
  inventoryFolderPathBodySchema,
  renameInventoryFolderSchema,
  updateInventorySchema,
  type InventoryRecord,
  type InventoryScope,
  type ResolvedInventoryItem,
} from '@/lib/schemas/inventory.types';
import { findDependents } from '@/lib/inventory/dependents';
import { assertInventoryImageChoice } from '@/lib/inventory/item-images';
import {
  clearOverrides,
  copyInventoryItemsToFolder,
  createInventoryFolder,
  createInventoryItem,
  deleteInventoryFolder,
  deleteInventoryItem,
  detach,
  instantiate,
  moveInventoryItemsToFolder,
  renameInventoryFolder,
  updateInventoryItem,
} from '@/lib/inventory/item-mutations';
import { resolveInventoryLocation, type InventoryLocation } from '@/lib/inventory/location';
import { loadInventoryPool, loadPoolForLocation, type InventoryPool } from '@/lib/inventory/pool';
import { inventoryErrorResponse } from '@/lib/inventory/routes/responses';

type Params = Record<string, string>;
type Repos = RequestContext['repos'];

export interface InventoryRouteConfig<P extends Params> {
  scope: InventoryScope;
  /** The owner id from the route params; null for General. */
  paramsToId: (params: P) => string | null;
  /** Log-message prefix, e.g. `'[Projects v1]'`. */
  logTag: string;
  /** Metadata key naming the owner id in log lines, e.g. `'projectId'`. */
  logIdKey: string;
}

const LABELS: Record<InventoryScope, string> = {
  character: 'Character',
  group: 'Group',
  project: 'Project',
  general: 'Quilltap General',
};

/** The project context a character's request names, for the project tier. */
function projectContextOf(req: NextRequest): { projectId: string | null; chatId: string | null } {
  const params = new URL(req.url).searchParams;
  return { projectId: params.get('projectId'), chatId: params.get('chatId') };
}

/** Resolve one record for the wire: its archetype filled in, its tier tagged. */
function serialize(pool: InventoryPool, location: InventoryLocation, record: InventoryRecord): ResolvedInventoryItem {
  return pool.resolve({ ...record, origin: location.origin, mountPointId: location.mountPointId });
}

function makeResolver<P extends Params>(config: InventoryRouteConfig<P>) {
  /** The tier's location, or the response to answer. */
  return async function resolveLocation(
    ctx: RequestContext,
    params: P,
    ensure: boolean,
  ): Promise<{ ok: true; location: InventoryLocation } | { ok: false; response: NextResponse }> {
    const location = await resolveInventoryLocation(config.scope, config.paramsToId(params), ctx.repos, ctx.user.id, { ensure });
    if (location) return { ok: true, location };
    if (config.scope === 'general') {
      return { ok: false, response: serverError('Quilltap General store is not provisioned yet') };
    }
    return { ok: false, response: notFound(LABELS[config.scope]) };
  };
}

// ============================================================================
// Collection
// ============================================================================

export function createInventoryCollectionHandlers<P extends Params>(config: InventoryRouteConfig<P>) {
  const { scope, logTag, logIdKey } = config;
  const resolveLocation = makeResolver(config);

  /** A read probe never provisions a store: a tier with no store has nothing yet. */
  async function probe(ctx: RequestContext, params: P): Promise<InventoryLocation | null | NextResponse> {
    const id = config.paramsToId(params);
    const location = await resolveInventoryLocation(scope, id, ctx.repos, ctx.user.id, { ensure: false });
    if (location) return location;
    if (scope === 'general') return null;
    if (scope !== 'character' && id) {
      const owner = scope === 'project' ? await ctx.repos.projects.findById(id) : await ctx.repos.groups.findById(id);
      if (owner) return null;
    }
    return notFound(LABELS[scope]);
  }

  async function handleList(req: NextRequest, ctx: RequestContext, params: P) {
    const found = await probe(ctx, params);
    if (found instanceof NextResponse) return found;
    if (!found) return successResponse({ mountPointId: null, items: [] });
    const location = found;
    const includeArchived = readIncludeArchived(req);
    const shared = scope === 'character' && new URL(req.url).searchParams.get('shared') === 'true';

    let items: ResolvedInventoryItem[];
    if (shared) {
      const pool = await loadInventoryPool(ctx.repos, { characterId: location.characterId as string, ...projectContextOf(req) });
      items = includeArchived ? Array.from(pool.byId.values()).map((r) => pool.resolve(r)) : pool.resolved();
    } else {
      const pool = await loadPoolForLocation(ctx.repos, location);
      items = (await location.readItems(includeArchived)).map((record) => serialize(pool, location, record));
    }
    logger.debug(`${logTag} Listed inventory`, {
      [logIdKey]: location.id,
      mountPointId: location.mountPointId,
      count: items.length,
      shared,
      includeArchived,
      context: 'inventory',
    });
    return successResponse({ mountPointId: location.mountPointId, items });
  }

  async function handleGetFolders(_req: NextRequest, ctx: RequestContext, params: P) {
    const found = await probe(ctx, params);
    if (found instanceof NextResponse) return found;
    if (!found) return successResponse({ folders: [] });
    const folders = await found.listFolders();
    logger.debug(`${logTag} Listed inventory folders`, { [logIdKey]: found.id, count: folders.length, context: 'inventory' });
    return successResponse({ folders });
  }

  async function handleGetArchetypes(req: NextRequest, ctx: RequestContext, params: P) {
    const found = await probe(ctx, params);
    if (found instanceof NextResponse) return found;
    if (!found) return successResponse({ items: [] });
    const pool = await loadPoolForLocation(ctx.repos, found, projectContextOf(req));
    const items = pool.resolved().filter((item) => item.isArchetype);
    logger.debug(`${logTag} Listed reachable archetypes`, { [logIdKey]: found.id, count: items.length, context: 'inventory' });
    return successResponse({ items });
  }

  async function handleCreate(req: NextRequest, ctx: RequestContext, params: P) {
    // Parse before resolving: an invalid body must never provision a store.
    const body = createInventorySchema.parse(await req.json());
    const resolved = await resolveLocation(ctx, params, true);
    if (!resolved.ok) return resolved.response;
    const { location } = resolved;
    try {
      const pool = body.kind === 'kit' ? await loadPoolForLocation(ctx.repos, location, projectContextOf(req)) : undefined;
      const record = await createInventoryItem(ctx.repos, location, body, { pool });
      logger.info(`${logTag} Created inventory object`, {
        [logIdKey]: location.id,
        userId: ctx.user.id,
        mountPointId: location.mountPointId,
        itemId: record.id,
        kind: record.kind,
        context: 'inventory',
      });
      return created({ item: serialize(pool ?? (await loadPoolForLocation(ctx.repos, location)), location, record) });
    } catch (error) {
      return inventoryErrorResponse(error);
    }
  }

  async function handleInstantiate(req: NextRequest, ctx: RequestContext, params: P) {
    const body = instantiateInventorySchema.parse(await req.json());
    const resolved = await resolveLocation(ctx, params, true);
    if (!resolved.ok) return resolved.response;
    const { location } = resolved;
    try {
      const pool = await loadPoolForLocation(ctx.repos, location, {
        projectId: body.projectId ?? null,
        chatId: body.chatId ?? null,
      });
      const { record, item } = await instantiate(ctx.repos, location, body.archetypeId, {
        folder: body.folder,
        overrides: body.overrides,
        pool,
      });
      logger.info(`${logTag} Instantiated archetype`, {
        [logIdKey]: location.id,
        userId: ctx.user.id,
        itemId: record.id,
        archetypeId: body.archetypeId,
        context: 'inventory',
      });
      return created({ item: { ...item, origin: location.origin } });
    } catch (error) {
      return inventoryErrorResponse(error);
    }
  }

  async function handleCreateFolder(req: NextRequest, ctx: RequestContext, params: P) {
    const body = inventoryFolderPathBodySchema.parse(await req.json());
    const resolved = await resolveLocation(ctx, params, true);
    if (!resolved.ok) return resolved.response;
    try {
      return successResponse({ folder: await createInventoryFolder(resolved.location, body.path) });
    } catch (error) {
      return inventoryErrorResponse(error);
    }
  }

  async function handleRenameFolder(req: NextRequest, ctx: RequestContext, params: P) {
    const body = renameInventoryFolderSchema.parse(await req.json());
    const resolved = await resolveLocation(ctx, params, false);
    if (!resolved.ok) return resolved.response;
    try {
      return successResponse({ folder: await renameInventoryFolder(resolved.location, body.path, body.name) });
    } catch (error) {
      return inventoryErrorResponse(error);
    }
  }

  async function handleDeleteFolder(req: NextRequest, ctx: RequestContext, params: P) {
    const body = inventoryFolderPathBodySchema.parse(await req.json());
    const resolved = await resolveLocation(ctx, params, false);
    if (!resolved.ok) return resolved.response;
    try {
      return successResponse(await deleteInventoryFolder(resolved.location, body.path));
    } catch (error) {
      return inventoryErrorResponse(error);
    }
  }

  async function handleFileItems(action: 'move' | 'copy', req: NextRequest, ctx: RequestContext, params: P) {
    const body = fileInventoryItemsSchema.parse(await req.json());
    const resolved = await resolveLocation(ctx, params, false);
    if (!resolved.ok) return resolved.response;
    const { location } = resolved;
    try {
      const records = action === 'move'
        ? await moveInventoryItemsToFolder(location, body.itemIds, body.folder)
        : await copyInventoryItemsToFolder(ctx.repos, location, body.itemIds, body.folder);
      const pool = await loadPoolForLocation(ctx.repos, location);
      logger.info(`${logTag} ${action === 'move' ? 'Moved' : 'Copied'} inventory objects to folder`, {
        [logIdKey]: location.id,
        userId: ctx.user.id,
        folder: body.folder,
        count: records.length,
        context: 'inventory',
      });
      return successResponse({ items: records.map((record) => serialize(pool, location, record)) });
    } catch (error) {
      return inventoryErrorResponse(error);
    }
  }

  const GET = createContextParamsHandler<P>(
    withActionDispatch<P>({ folders: handleGetFolders, archetypes: handleGetArchetypes }, handleList),
  );

  const POST = createContextParamsHandler<P>(
    withActionDispatch<P>(
      {
        instantiate: handleInstantiate,
        'create-folder': handleCreateFolder,
        'rename-folder': handleRenameFolder,
        'delete-folder': handleDeleteFolder,
        'move-items': (req, ctx, params) => handleFileItems('move', req, ctx, params),
        'copy-items': (req, ctx, params) => handleFileItems('copy', req, ctx, params),
      },
      handleCreate,
    ),
  );

  return { GET, POST };
}

// ============================================================================
// Item
// ============================================================================

export function createInventoryItemHandlers<P extends Params & { itemId: string }>(config: InventoryRouteConfig<P>) {
  const { logTag, logIdKey } = config;
  const resolveLocation = makeResolver(config);

  async function findRecord(
    ctx: RequestContext,
    params: P,
  ): Promise<{ ok: true; location: InventoryLocation; record: InventoryRecord } | { ok: false; response: NextResponse }> {
    const resolved = await resolveLocation(ctx, params, false);
    if (!resolved.ok) return resolved;
    const record = await resolved.location.findItem(params.itemId);
    if (!record) return { ok: false, response: notFound('Inventory object') };
    return { ok: true, location: resolved.location, record };
  }

  async function respondWith(ctx: RequestContext, location: InventoryLocation, record: InventoryRecord | null) {
    if (!record) return notFound('Inventory object');
    const pool = await loadPoolForLocation(ctx.repos as Repos, location);
    return successResponse({ item: serialize(pool, location, record) });
  }

  async function handleGetOne(_req: NextRequest, ctx: RequestContext, params: P) {
    const found = await findRecord(ctx, params);
    if (!found.ok) return found.response;
    return respondWith(ctx, found.location, found.record);
  }

  async function handleGetDependents(_req: NextRequest, ctx: RequestContext, params: P) {
    const found = await findRecord(ctx, params);
    if (!found.ok) return found.response;
    const dependents = found.record.isArchetype ? await findDependents(found.record.id) : [];
    logger.debug(`${logTag} Listed archetype dependents`, {
      [logIdKey]: found.location.id,
      itemId: found.record.id,
      count: dependents.length,
      context: 'inventory',
    });
    return successResponse({ dependents });
  }

  async function handleUpdate(req: NextRequest, ctx: RequestContext, params: P) {
    const found = await findRecord(ctx, params);
    if (!found.ok) return found.response;
    const body = updateInventorySchema.parse(await req.json());
    try {
      if (body.imageFileId !== undefined) await assertInventoryImageChoice(ctx.repos, found.record.id, body.imageFileId);
      const record = await updateInventoryItem(ctx.repos, found.location, found.record, body);
      logger.info(`${logTag} Updated inventory object`, {
        [logIdKey]: found.location.id,
        userId: ctx.user.id,
        itemId: found.record.id,
        context: 'inventory',
      });
      return respondWith(ctx, found.location, record);
    } catch (error) {
      return inventoryErrorResponse(error);
    }
  }

  async function handleClearOverride(req: NextRequest, ctx: RequestContext, params: P) {
    const found = await findRecord(ctx, params);
    if (!found.ok) return found.response;
    const body = clearInventoryOverrideSchema.parse(await req.json());
    try {
      return respondWith(ctx, found.location, await clearOverrides(found.location, found.record, body.fields));
    } catch (error) {
      return inventoryErrorResponse(error);
    }
  }

  async function handleDetach(_req: NextRequest, ctx: RequestContext, params: P) {
    const found = await findRecord(ctx, params);
    if (!found.ok) return found.response;
    try {
      const record = await detach(ctx.repos, found.location, found.record);
      logger.info(`${logTag} Detached instance`, { [logIdKey]: found.location.id, itemId: found.record.id, context: 'inventory' });
      return respondWith(ctx, found.location, record);
    } catch (error) {
      return inventoryErrorResponse(error);
    }
  }

  const GET = createContextParamsHandler<P>(withActionDispatch<P>({ dependents: handleGetDependents }, handleGetOne));

  const PUT = createContextParamsHandler<P>(
    withActionDispatch<P>({ 'clear-override': handleClearOverride, detach: handleDetach }, handleUpdate),
  );

  const DELETE = createContextParamsHandler<P>(async (req, ctx, params) => {
    const found = await findRecord(ctx, params);
    if (!found.ok) return found.response;
    const force = new URL(req.url).searchParams.get('force') === 'true';
    try {
      const result = await deleteInventoryItem(ctx.repos, found.location, found.record, { force });
      if (!result.deleted) return notFound('Inventory object');
      logger.info(`${logTag} Deleted inventory object`, {
        [logIdKey]: found.location.id,
        userId: ctx.user.id,
        itemId: found.record.id,
        force,
        detached: result.detached,
        context: 'inventory',
      });
      return successResponse({ success: true, detached: result.detached });
    } catch (error) {
      return inventoryErrorResponse(error);
    }
  });

  return { GET, PUT, DELETE };
}
