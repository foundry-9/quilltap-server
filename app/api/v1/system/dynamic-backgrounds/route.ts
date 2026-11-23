/**
 * Dynamic Backgrounds
 *
 * GET /api/v1/system/dynamic-backgrounds?scope=…&id=…&orientation=…
 *   Whether the page may have a collage, and the URL of a fresh one (JSON).
 * GET /api/v1/system/dynamic-backgrounds?action=image&scope=…&id=…&orientation=…&seed=…
 *   The composed collage (`image/webp`); 404 when the setting is off, the
 *   scope is unknown or the pool is below the floor.
 *
 * Settings, pool and the uncensored decision are re-resolved on every
 * request by `lib/dynamic-backgrounds/`; none of them is a query parameter.
 * The image is user bytes and goes out through `serveStoredBytes`.
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createContextHandler, type RequestContext } from '@/lib/api/middleware';
import { withCollectionActionDispatch, getQueryParamsWithoutAction } from '@/lib/api/middleware/actions';
import { notFound, successResponse } from '@/lib/api/responses';
import { serveStoredBytes } from '@/lib/api/serve-stored-bytes';
import { logger } from '@/lib/logger';
import {
  CollageScopeNotFoundError,
  describeCollage,
  drawCollage,
} from '@/lib/dynamic-backgrounds';

const log = logger.child({ module: 'api.v1.system.dynamic-backgrounds' });

const ScopeQuery = z
  .object({
    scope: z.enum(['home', 'project', 'character']),
    id: z.string().uuid().optional(),
    orientation: z.enum(['landscape', 'portrait']).default('landscape'),
  })
  .strict()
  .refine((q) => (q.scope === 'home' ? q.id === undefined : q.id !== undefined), {
    message: '`id` is required for project and character, and refused for home',
    path: ['id'],
  });

const ImageQuery = z
  .object({
    scope: z.enum(['home', 'project', 'character']),
    id: z.string().uuid().optional(),
    orientation: z.enum(['landscape', 'portrait']).default('landscape'),
    seed: z.string().regex(/^[0-9a-f]{1,64}$/i),
  })
  .strict()
  .refine((q) => (q.scope === 'home' ? q.id === undefined : q.id !== undefined), {
    message: '`id` is required for project and character, and refused for home',
    path: ['id'],
  });

async function handleStatus(request: NextRequest, ctx: RequestContext) {
  const query = ScopeQuery.parse(getQueryParamsWithoutAction(request));
  log.debug('Collage status requested', { scope: query.scope, id: query.id, orientation: query.orientation });
  try {
    const status = await describeCollage(
      { userId: ctx.user.id, scope: query.scope, id: query.id ?? null, orientation: query.orientation },
      ctx.repos,
    );
    return successResponse(status);
  } catch (error) {
    if (error instanceof CollageScopeNotFoundError) return notFound('Project');
    throw error;
  }
}

async function handleImage(request: NextRequest, ctx: RequestContext) {
  const query = ImageQuery.parse(getQueryParamsWithoutAction(request));
  log.debug('Collage image requested', { scope: query.scope, id: query.id, orientation: query.orientation });
  let buffer: Buffer | null;
  try {
    buffer = await drawCollage(
      {
        userId: ctx.user.id,
        scope: query.scope,
        id: query.id ?? null,
        orientation: query.orientation,
        seed: query.seed,
      },
      ctx.repos,
    );
  } catch (error) {
    if (error instanceof CollageScopeNotFoundError) return notFound('Project');
    log.warn('Collage could not be drawn', {
      scope: query.scope,
      error: error instanceof Error ? error.message : String(error),
    });
    return notFound('Collage');
  }
  if (!buffer) return notFound('Collage');
  return serveStoredBytes(new Uint8Array(buffer), {
    mimeType: 'image/webp',
    filename: 'collage.webp',
    requested: 'inline',
    // A URL names one seed and one pool; the browser may keep it a while.
    cacheControl: 'private, max-age=3600',
  });
}

export const GET = createContextHandler(
  withCollectionActionDispatch({ image: handleImage }, handleStatus),
);
