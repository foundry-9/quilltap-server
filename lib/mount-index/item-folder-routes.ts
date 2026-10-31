/**
 * The folder actions every tiered item collection route offers (the
 * wardrobe's and the Inventory's, at all four tiers), stated once:
 * `?action=create-folder`, `rename-folder` and `delete-folder`. Each parses
 * its body, resolves the tier's location (provisioning a missing store only
 * to create a folder), runs the shared folder mutation, logs, and answers;
 * a refusal answers through the kind's own error mapper.
 *
 * A route factory spreads the result into its `withActionDispatch` map.
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
import { successResponse } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import {
  createItemFolder,
  deleteItemFolder,
  renameItemFolder,
  type ItemFolderKind,
  type ItemFolderLocation,
} from '@/lib/mount-index/item-folder-location';

type ResolvedLocation<L> = { ok: true; location: L } | { ok: false; response: NextResponse };

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
