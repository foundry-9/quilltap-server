/**
 * The route preamble every tiered item collection shares (the wardrobe's and
 * the Inventory's, at all four tiers), stated once:
 *
 *   - {@link ItemRouteConfig}: what each route file declares (scope, how to
 *     read the owner id from its params, its log tag and log id key). The
 *     scenario factory adopts the same shape ({@link ItemRouteConfigBase}).
 *   - Per-tier labels: the owner's 404 ({@link OWNER_LABELS}) and the item's
 *     (each kind's `itemLabels`), so a missing project item says "Project
 *     wardrobe item" / "Project inventory object" rather than a generic noun.
 *   - One error mapping, {@link itemErrorResponse} / {@link withItemErrors}:
 *     the folder refusals both kinds share (via the base classes in
 *     `item-folders.ts`) and the archived-character tombstone, after the
 *     kind's own refusals (`ItemErrorKind.refusals`) have had their say.
 *   - The location resolver ({@link itemRoutePreamble}'s `resolveLocation`)
 *     and the read probe (`probe`), which **never provisions**: a project or
 *     group with no store yet, or an unprovisioned General, answers empty.
 *     No GET passes `ensure`.
 *   - `GET ?action=folders` and the folder write actions
 *     `?action=create-folder`, `rename-folder` and `delete-folder`. Each
 *     write parses its body, resolves the tier's location (provisioning a
 *     missing store only to create a folder), runs the shared folder
 *     mutation, logs, and answers; a refusal answers through the kind's
 *     error mapping.
 *
 * Response keys stay per kind (`wardrobeItems` vs `items`) — the factories
 * own their list and item bodies; only the preamble is shared.
 *
 * A route factory spreads `folderActions` into its `withActionDispatch` map.
 * Item filing (`move-items` / `copy-items`) stays per kind: the wardrobe's
 * outfits bring their components, the Inventory's copies are gated by
 * `canCopy`.
 *
 * Server-only.
 *
 * @module lib/mount-index/item-folder-routes
 */

import type { NextRequest, NextResponse } from 'next/server';
import type { ZodType } from 'zod';
import type { RequestContext } from '@/lib/api/middleware/context';
import { badRequest, conflict, notFound, serverError, successResponse } from '@/lib/api/responses';
import { CharacterArchivedError } from '@/lib/characters/archive-guard';
import { logger } from '@/lib/logger';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import {
  ItemFolderConflictError,
  ItemFolderNotFoundError,
  ItemFolderPathError,
  ItemNotInLocationError,
} from '@/lib/mount-index/item-folders';
import {
  createItemFolder,
  deleteItemFolder,
  renameItemFolder,
  type ItemFolderKind,
  type ItemFolderLocation,
} from '@/lib/mount-index/item-folder-location';

type ResolvedLocation<L> = { ok: true; location: L } | { ok: false; response: NextResponse };

/** A read probe's answer: the location (null: nothing provisioned yet), or the response to answer. */
export type ProbedLocation<L> = { ok: true; location: L | null } | { ok: false; response: NextResponse };

export interface ItemFolderRouteConfig<P, L extends ItemFolderLocation> {
  kind: ItemFolderKind;
  /** The route's log prefix, e.g. `[Projects Wardrobe v1]`. */
  logTag: string;
  /** The key the tier's owner id is logged under, e.g. `projectId`. */
  logIdKey: string;
  /** Resolve the tier's location; `ensure` provisions a missing store. */
  resolveLocation: (ctx: RequestContext, params: P, ensure: boolean) => Promise<ResolvedLocation<L>>;
  /** Map a refusal to its response; rethrow anything else. */
  errorResponse: (error: unknown) => NextResponse;
  schemas: {
    /** `{ path }` — create-folder and delete-folder. */
    path: ZodType<{ path: string }>;
    /** `{ path, name }` — rename-folder. */
    rename: ZodType<{ path: string; name: string }>;
  };
}

type Handler<P> = (req: NextRequest, ctx: RequestContext, params: P) => Promise<NextResponse>;

export function itemFolderActionHandlers<P, L extends ItemFolderLocation>(
  config: ItemFolderRouteConfig<P, L>,
): Record<'create-folder' | 'rename-folder' | 'delete-folder', Handler<P>> {
  const { kind, logTag, logIdKey, resolveLocation, errorResponse, schemas } = config;
  const context = kind.rules.noun;

  const logDone = (op: string, ctx: RequestContext, location: L, meta: Record<string, unknown>): void => {
    logger.info(`${logTag} ${op} ${context} folder`, {
      [logIdKey]: location.id,
      userId: ctx.user.id,
      mountPointId: location.mountPointId,
      ...meta,
      context,
    });
  };

  return {
    'create-folder': async (req, ctx, params) => {
      const body = schemas.path.parse(await req.json());
      const resolved = await resolveLocation(ctx, params, true);
      if (!resolved.ok) return resolved.response;
      try {
        const folder = await createItemFolder(kind, resolved.location, body.path);
        logDone('Created', ctx, resolved.location, { folder: folder.path });
        return successResponse({ folder });
      } catch (error) {
        return errorResponse(error);
      }
    },
    'rename-folder': async (req, ctx, params) => {
      const body = schemas.rename.parse(await req.json());
      const resolved = await resolveLocation(ctx, params, false);
      if (!resolved.ok) return resolved.response;
      try {
        const folder = await renameItemFolder(kind, resolved.location, body.path, body.name);
        logDone('Renamed', ctx, resolved.location, { from: body.path, to: folder.path });
        return successResponse({ folder });
      } catch (error) {
        return errorResponse(error);
      }
    },
    'delete-folder': async (req, ctx, params) => {
      const body = schemas.path.parse(await req.json());
      const resolved = await resolveLocation(ctx, params, false);
      if (!resolved.ok) return resolved.response;
      try {
        const result = await deleteItemFolder(kind, resolved.location, body.path);
        logDone('Deleted', ctx, resolved.location, { folder: body.path, ...result });
        return successResponse(result);
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

// ============================================================================
// The shared preamble
// ============================================================================

/** The four tiers an item collection lives at. */
export type ItemTierScope = ItemFolderLocation['scope'];

/** What every tiered route declares, minus how it reads its owner id. */
export interface ItemRouteConfigBase<S extends string = ItemTierScope> {
  scope: S;
  /** Log-message prefix, e.g. `'[Projects v1]'`. */
  logTag: string;
  /** Metadata key naming the owner id in log lines, e.g. `'projectId'`. */
  logIdKey: string;
}

/** What each tiered item route file declares: the factories' one config shape. */
export interface ItemRouteConfig<P, S extends string = ItemTierScope> extends ItemRouteConfigBase<S> {
  /** The owner id from the route params; null for General. */
  paramsToId: (params: P) => string | null;
  /**
   * Collection actions only one tier's route answers — the General route's
   * cross-tier `move-to-tier` / `copy-to-tier`, for one — added to the
   * factory's own `?action=` table. Never used to override a shared action.
   */
  extraGetActions?: Record<string, ItemRouteActionHandler<P>>;
  extraPostActions?: Record<string, ItemRouteActionHandler<P>>;
}

/** A collection action handler a route adds to its factory's table. */
export type ItemRouteActionHandler<P> = (req: NextRequest, ctx: RequestContext, params: P) => Promise<NextResponse>;

/** The owner a tier's 404 names, the same for every kind. */
export const OWNER_LABELS: Record<ItemTierScope, string> = {
  character: 'Character',
  group: 'Group',
  project: 'Project',
  general: 'Quilltap General',
};

/** How one kind's refusals become responses (see {@link itemErrorResponse}). */
export interface ItemErrorKind {
  /** The kind's noun, e.g. `wardrobe` — names the folder 404 and the archived 409. */
  noun: string;
  /**
   * The kind's own refusals, tried first: the response for one of them, or
   * null to fall through to the shared mapping.
   */
  refusals?: (error: unknown) => NextResponse | null;
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * The response for an item refusal, or rethrow anything else: the kind's own
 * refusals first, then the folder refusals both kinds share (a bad path or a
 * borrowed id is a 400, a missing folder a 404, a collision a 409) and an
 * archived character's vault (409).
 */
export function itemErrorResponse(kind: ItemErrorKind, error: unknown): NextResponse {
  const own = kind.refusals?.(error);
  if (own) return own;
  if (error instanceof ItemFolderPathError) return badRequest(error.message);
  if (error instanceof ItemNotInLocationError) return badRequest(error.message);
  if (error instanceof ItemFolderNotFoundError) return notFound(`${capitalise(kind.noun)} folder`);
  if (error instanceof ItemFolderConflictError) return conflict(error.message);
  if (error instanceof CharacterArchivedError) {
    logger.info(`[Item routes] Refused a ${kind.noun} write to an archived character`, { context: kind.noun });
    return conflict(`An archived character's ${kind.noun} cannot be changed`);
  }
  throw error;
}

/**
 * Wrap a route handler so any refusal it throws answers through
 * {@link itemErrorResponse}. Anything else (a body that fails its Zod schema,
 * an unexpected error) propagates to the middleware as before.
 */
export function withItemErrors(kind: ItemErrorKind) {
  return function wrap<A extends unknown[]>(
    handler: (...args: A) => Promise<NextResponse>,
  ): (...args: A) => Promise<NextResponse> {
    return async (...args) => {
      try {
        return await handler(...args);
      } catch (error) {
        return itemErrorResponse(kind, error);
      }
    };
  };
}

/** Everything a tiered item kind tells the shared preamble. */
export interface ItemRouteKind<L extends ItemFolderLocation> {
  /** The folder kind: its rules (and `rules.noun`) and its path error. */
  folderKind: ItemFolderKind;
  /** The item a tier's 404 names, per tier. */
  itemLabels: Record<ItemTierScope, string>;
  /** The kind's tier resolver (`resolveWardrobeLocation` / `resolveInventoryLocation`). */
  resolve: (
    scope: ItemTierScope,
    id: string | null,
    repos: RepositoryContainer,
    userId: string,
    opts: { ensure?: boolean },
  ) => Promise<L | null>;
  errors: ItemErrorKind;
  folderSchemas: ItemFolderRouteConfig<unknown, L>['schemas'];
}

/**
 * The preamble one route factory builds once per tier config: its labels, its
 * resolver, its read probe, its error mapping and its folder routes.
 */
export function itemRoutePreamble<P, L extends ItemFolderLocation>(
  kind: ItemRouteKind<L>,
  config: ItemRouteConfig<P>,
) {
  const { scope, logTag, logIdKey } = config;
  const noun = kind.folderKind.rules.noun;
  const labels = { owner: OWNER_LABELS[scope], item: kind.itemLabels[scope] };

  /**
   * Resolve the tier's location, or the response to answer. `ensure`
   * provisions a missing project/group store and folder; only a write passes
   * it.
   */
  async function resolveLocation(ctx: RequestContext, params: P, ensure: boolean): Promise<ResolvedLocation<L>> {
    const location = await kind.resolve(scope, config.paramsToId(params), ctx.repos, ctx.user.id, { ensure });
    if (location) return { ok: true, location };
    logger.debug(`${logTag} No ${noun} location`, { scope, ensure, context: noun });
    if (scope === 'general') {
      return { ok: false, response: serverError('Quilltap General store is not provisioned yet') };
    }
    return { ok: false, response: notFound(labels.owner) };
  }

  /**
   * The read probe: the tier's location; `location: null` when the owner
   * exists but has no store yet (or General is unprovisioned) — an empty
   * answer, never a store minted by a read; or the 404 to answer.
   */
  async function probe(ctx: RequestContext, params: P): Promise<ProbedLocation<L>> {
    const id = config.paramsToId(params);
    const location = await kind.resolve(scope, id, ctx.repos, ctx.user.id, { ensure: false });
    if (location) return { ok: true, location };
    if (scope === 'general') {
      logger.debug(`${logTag} General not provisioned; nothing to read`, { context: noun });
      return { ok: true, location: null };
    }
    if (scope !== 'character' && id) {
      const owner = scope === 'project' ? await ctx.repos.projects.findById(id) : await ctx.repos.groups.findById(id);
      if (owner) {
        logger.debug(`${logTag} No store yet; nothing to read`, { [logIdKey]: id, scope, context: noun });
        return { ok: true, location: null };
      }
    }
    return { ok: false, response: notFound(labels.owner) };
  }

  async function getFolders(_req: NextRequest, ctx: RequestContext, params: P): Promise<NextResponse> {
    const probed = await probe(ctx, params);
    if (!probed.ok) return probed.response;
    const found = probed.location;
    if (!found) return successResponse({ folders: [] });
    const folders = await found.listFolders();
    logger.debug(`${logTag} Listed ${noun} folders`, {
      [logIdKey]: found.id,
      mountPointId: found.mountPointId,
      count: folders.length,
      context: noun,
    });
    return successResponse({ folders });
  }

  const errorResponse = (error: unknown): NextResponse => itemErrorResponse(kind.errors, error);

  const folderActions = itemFolderActionHandlers<P, L>({
    kind: kind.folderKind,
    logTag,
    logIdKey,
    resolveLocation,
    errorResponse,
    schemas: kind.folderSchemas,
  });

  return {
    labels,
    resolveLocation,
    probe,
    getFolders,
    errorResponse,
    withErrors: withItemErrors(kind.errors),
    folderActions,
  };
}
