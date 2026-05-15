/**
 * Character photo gallery API v1 — Collection endpoint
 *
 * GET  /api/v1/characters/[id]/photos     List photos in the character's vault `photos/` folder
 * POST /api/v1/characters/[id]/photos     Upload a new photo (multipart/form-data: file, caption?, tags?)
 *
 * Phase 3 of the photo-albums work — Aurora's `EmbeddedPhotoGallery` reads
 * this endpoint instead of the legacy `/api/v1/images` + CHARACTER-tag
 * filter.
 *
 * Backed by `lib/photos/character-gallery-service.ts`.
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { successResponse, created, badRequest, notFound, serverError } from '@/lib/api/responses';
import {
  saveToCharacterGallery,
  listCharacterGallery,
} from '@/lib/photos/character-gallery-service';

const listQuerySchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
});

export const GET = createAuthenticatedParamsHandler<{ id: string }>(
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

      const result = await listCharacterGallery({
        characterId: id,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
        repos,
      });

      return successResponse(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list character gallery';
      if (message.startsWith('Character not found')) {
        return notFound('Character');
      }
      logger.error('[Characters/Photos v1] Error listing character gallery', { userId: user.id, characterId: id }, error instanceof Error ? error : undefined);
      return serverError(message);
    }
  }
);

export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }, { id }) => {
    try {
      if (!id) return badRequest('Missing character id');

      const formData = await req.formData().catch(() => null);
      if (!formData) {
        return badRequest('Request body must be multipart/form-data');
      }

      const fileField = formData.get('file');
      if (!(fileField instanceof File)) {
        return badRequest('Missing "file" field in upload');
      }
      const caption = (formData.get('caption') as string | null) ?? null;
      const rawTags = formData.getAll('tags');
      const tags = rawTags
        .filter((t): t is string => typeof t === 'string' && t.length > 0);

      const buffer = Buffer.from(await fileField.arrayBuffer());
      const result = await saveToCharacterGallery({
        characterId: id,
        data: buffer,
        filename: fileField.name || 'upload',
        mimeType: fileField.type || 'application/octet-stream',
        caption,
        tags,
        repos,
      });

      return created(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save photo';
      if (message.startsWith('Character not found')) {
        return notFound('Character');
      }
      if (
        message.includes('already in') ||
        message.includes('no linked database-backed vault') ||
        message.includes('Unsupported MIME type') ||
        message.includes('Uploaded image is empty')
      ) {
        return badRequest(message);
      }
      logger.error('[Characters/Photos v1] Error saving photo', { userId: user.id, characterId: id }, error instanceof Error ? error : undefined);
      return serverError(message);
    }
  }
);
