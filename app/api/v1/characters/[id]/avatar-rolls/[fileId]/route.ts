/**
 * Character avatar rolls API v1 — Item endpoint
 *
 * POST   /api/v1/characters/[id]/avatar-rolls/[fileId]?action=save-to-album
 *   Hard-link the roll's bytes into the character's vault `photos/` folder.
 * POST   /api/v1/characters/[id]/avatar-rolls/[fileId]?action=set-avatar
 *   Copy into the album (if it isn't there yet) and make it the portrait.
 * DELETE /api/v1/characters/[id]/avatar-rolls/[fileId]
 *   Throw the plate away, scrubbing every pointer at it first. An album copy
 *   of the same bytes is never a casualty.
 *
 * `[fileId]` is the `files.id` returned by `GET .../avatar-rolls` — the id a
 * chat binds when the wardrobe avatar job reuses a cached configuration.
 *
 * Backed by `lib/photos/avatar-rolls-service.ts`.
 */

import { NextResponse } from 'next/server';
import { createContextParamsHandler } from '@/lib/api/middleware';
import { withActionDispatch, type ActionHandler } from '@/lib/api/middleware/actions';
import { logger } from '@/lib/logger';
import { successResponse, badRequest, notFound, serverError } from '@/lib/api/responses';
import {
  saveAvatarRollToAlbum,
  setAvatarRollAsPortrait,
  deleteAvatarRoll,
} from '@/lib/photos/avatar-rolls-service';
import type { RequestContext } from '@/lib/api/middleware';

type Params = { id: string; fileId: string };

/**
 * Map a service error onto the right status. "Not found" covers both an
 * unknown id and an id that is a `files` row but not one of this character's
 * rolls — the caller has no business telling those apart.
 */
function respondToError(
  error: unknown,
  ctx: RequestContext,
  params: Params,
  fallback: string
): NextResponse {
  const message = error instanceof Error ? error.message : fallback;
  if (message.startsWith('Character not found')) {
    return notFound('Character');
  }
  if (message.startsWith('Avatar roll not found')) {
    return notFound('Avatar roll');
  }
  if (
    message.includes('no linked database-backed vault') ||
    message.includes('not an image') ||
    message.includes('empty bytes') ||
    message.includes('already in')
  ) {
    return badRequest(message);
  }
  logger.error(
    '[Characters/AvatarRolls v1] Avatar roll action failed',
    { userId: ctx.user.id, characterId: params.id, fileId: params.fileId },
    error instanceof Error ? error : undefined
  );
  return serverError(message);
}

const handleSaveToAlbum: ActionHandler<Params> = async (_req, ctx, params) => {
  try {
    const result = await saveAvatarRollToAlbum({
      characterId: params.id,
      fileId: params.fileId,
      repos: ctx.repos,
    });
    return successResponse(result);
  } catch (error) {
    return respondToError(error, ctx, params, 'Failed to save the roll to the album');
  }
};

const handleSetAvatar: ActionHandler<Params> = async (_req, ctx, params) => {
  try {
    const result = await setAvatarRollAsPortrait({
      characterId: params.id,
      fileId: params.fileId,
      repos: ctx.repos,
    });
    return successResponse(result);
  } catch (error) {
    return respondToError(error, ctx, params, 'Failed to set the roll as the portrait');
  }
};

export const POST = createContextParamsHandler<Params>(
  withActionDispatch<Params>({
    'save-to-album': handleSaveToAlbum,
    'set-avatar': handleSetAvatar,
  })
);

export const DELETE = createContextParamsHandler<Params>(
  async (_req, ctx, { id, fileId }) => {
    try {
      if (!id) return badRequest('Missing character id');
      if (!fileId) return badRequest('Missing avatar roll id');

      const result = await deleteAvatarRoll({
        characterId: id,
        fileId,
        repos: ctx.repos,
      });
      if (!result.deleted) return notFound('Avatar roll');

      return successResponse(result);
    } catch (error) {
      return respondToError(error, ctx, { id, fileId }, 'Failed to delete the avatar roll');
    }
  }
);
