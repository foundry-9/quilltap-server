/**
 * Character Clothing Record Detail API v1
 *
 * GET /api/v1/characters/[id]/clothing/[recordId] - Get a clothing record
 * PUT /api/v1/characters/[id]/clothing/[recordId] - Update a clothing record
 * DELETE /api/v1/characters/[id]/clothing/[recordId] - Delete a clothing record
 */

import { NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler, checkOwnership } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { notFound, serverError, validationError } from '@/lib/api/responses';

const updateClothingRecordSchema = z.object({
  name: z.string().min(1).optional(),
  usageContext: z.string().max(200).nullable().optional(),
  description: z.string().nullable().optional(),
});

// GET /api/v1/characters/[id]/clothing/[recordId]
export const GET = createAuthenticatedParamsHandler<{ id: string; recordId: string }>(
  async (req, { user, repos }, { id, recordId }) => {
    try {
      const character = await repos.characters.findById(id);

      if (!checkOwnership(character, user.id)) {
        return notFound('Character');
      }

      const record = await repos.characters.getClothingRecord(id, recordId);

      if (!record) {
        return notFound('Clothing record');
      }

      return NextResponse.json({ clothingRecord: record });
    } catch (error) {
      logger.error('[Characters v1] Error fetching clothing record', { characterId: id, recordId }, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch clothing record');
    }
  }
);

// PUT /api/v1/characters/[id]/clothing/[recordId]
export const PUT = createAuthenticatedParamsHandler<{ id: string; recordId: string }>(
  async (req, { user, repos }, { id, recordId }) => {
    try {
      const character = await repos.characters.findById(id);

      if (!checkOwnership(character, user.id)) {
        return notFound('Character');
      }

      const body = await req.json();
      const validatedData = updateClothingRecordSchema.parse(body);

      const record = await repos.characters.updateClothingRecord(id, recordId, validatedData);

      if (!record) {
        return notFound('Clothing record');
      }

      logger.info('[Characters v1] Clothing record updated', {
        characterId: id,
        recordId,
      });

      return NextResponse.json({ clothingRecord: record });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return validationError(error);
      }

      logger.error('[Characters v1] Error updating clothing record', { characterId: id, recordId }, error instanceof Error ? error : undefined);
      return serverError('Failed to update clothing record');
    }
  }
);

// DELETE /api/v1/characters/[id]/clothing/[recordId]
export const DELETE = createAuthenticatedParamsHandler<{ id: string; recordId: string }>(
  async (req, { user, repos }, { id, recordId }) => {
    try {
      const character = await repos.characters.findById(id);

      if (!checkOwnership(character, user.id)) {
        return notFound('Character');
      }

      const success = await repos.characters.removeClothingRecord(id, recordId);

      if (!success) {
        return notFound('Clothing record');
      }

      logger.info('[Characters v1] Clothing record deleted', {
        characterId: id,
        recordId,
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error('[Characters v1] Error deleting clothing record', { characterId: id, recordId }, error instanceof Error ? error : undefined);
      return serverError('Failed to delete clothing record');
    }
  }
);
