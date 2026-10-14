/**
 * Character avatar rolls API v1 — Collection endpoint
 *
 * GET /api/v1/characters/[id]/avatar-rolls
 *   Every plate the avatar configuration cache holds for this character —
 *   the `files` rows carrying a `generationKey`, newest first.
 *
 * The Aurora Photo Gallery tab renders these beneath the character's own
 * album. Backed by `lib/photos/avatar-rolls-service.ts`.
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createContextParamsHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { successResponse, badRequest, notFound, serverError } from '@/lib/api/responses';
import { listAvatarRolls } from '@/lib/photos/avatar-rolls-service';

const listQuerySchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
});

export const GET = createContextParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }, { id }) => {
    try {
      if (!id) return badRequest('Missing character id');

      const url = new URL(req.url);
      const parsed = listQuerySchema.safeParse({
        limit: url.searchParams.has('limit')
          ? Number(url.searchParams.get('limit'))
          : undefined,
        offset: url.searchParams.has('offset')
          ? Number(url.searchParams.get('offset'))
          : undefined,
      });
      if (!parsed.success) {
        return badRequest(parsed.error.issues.map(i => i.message).join('; '));
      }

      const result = await listAvatarRolls({
        characterId: id,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
        repos,
      });

      logger.debug('[Characters/AvatarRolls v1] Listed avatar rolls', {
        userId: user.id,
        characterId: id,
        returned: result.entries.length,
        total: result.total,
      });

      return successResponse(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list avatar rolls';
      if (message.startsWith('Character not found')) {
        return notFound('Character');
      }
      logger.error(
        '[Characters/AvatarRolls v1] Error listing avatar rolls',
        { userId: user.id, characterId: id },
        error instanceof Error ? error : undefined
      );
      return serverError(message);
    }
  }
);
