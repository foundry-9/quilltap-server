/**
 * Character wardrobe pictures API v1 — Collection endpoint
 *
 * GET /api/v1/characters/[id]/wardrobe-images
 *   Every generated picture of every wardrobe item the character can reach —
 *   their own vault, their groups' stores and Quilltap General — newest first,
 *   each tagged with its item's title and tier.
 *
 * The Aurora Photo Gallery tab renders these as its third section. Read-only;
 * backed by `lib/wardrobe/gallery-images.ts`.
 */

import { NextRequest } from 'next/server';
import { createContextParamsHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { successResponse, badRequest, notFound, serverError } from '@/lib/api/responses';
import { listWardrobeGalleryImages } from '@/lib/wardrobe/gallery-images';

export const GET = createContextParamsHandler<{ id: string }>(
  async (_req: NextRequest, { user, repos }, { id }) => {
    try {
      if (!id) return badRequest('Missing character id');

      const result = await listWardrobeGalleryImages(repos, id);

      logger.debug('[Characters/WardrobeImages v1] Listed wardrobe pictures', {
        userId: user.id,
        characterId: id,
        total: result.total,
      });

      return successResponse(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list wardrobe pictures';
      if (message.startsWith('Character not found')) {
        return notFound('Character');
      }
      logger.error(
        '[Characters/WardrobeImages v1] Error listing wardrobe pictures',
        { userId: user.id, characterId: id },
        error instanceof Error ? error : undefined
      );
      return serverError(message);
    }
  }
);
