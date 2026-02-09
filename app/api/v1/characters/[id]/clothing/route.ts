/**
 * Character Clothing Records API v1
 *
 * GET /api/v1/characters/[id]/clothing - Get all clothing records for a character
 * POST /api/v1/characters/[id]/clothing - Create a new clothing record
 */

import { NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler, checkOwnership } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { notFound, serverError, validationError, created } from '@/lib/api/responses';

const createClothingRecordSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  usageContext: z.string().max(200).nullable().optional(),
  description: z.string().nullable().optional(),
});

// GET /api/v1/characters/[id]/clothing
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      const character = await repos.characters.findById(id);

      if (!checkOwnership(character, user.id)) {
        return notFound('Character');
      }

      const clothingRecords = await repos.characters.getClothingRecords(id);
      return NextResponse.json({ clothingRecords });
    } catch (error) {
      logger.error('[Characters v1] Error fetching clothing records', { characterId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch clothing records');
    }
  }
);

// POST /api/v1/characters/[id]/clothing
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      const character = await repos.characters.findById(id);

      if (!checkOwnership(character, user.id)) {
        return notFound('Character');
      }

      const body = await req.json();
      const validatedData = createClothingRecordSchema.parse(body);

      const record = await repos.characters.addClothingRecord(id, validatedData);

      if (!record) {
        return serverError('Failed to create clothing record');
      }

      logger.info('[Characters v1] Clothing record created', {
        characterId: id,
        recordId: record.id,
        name: validatedData.name,
      });

      return created({ clothingRecord: record });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return validationError(error);
      }

      logger.error('[Characters v1] Error creating clothing record', { characterId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to create clothing record');
    }
  }
);
