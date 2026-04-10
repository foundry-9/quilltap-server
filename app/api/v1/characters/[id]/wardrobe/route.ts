/**
 * Character Wardrobe Items API v1
 *
 * GET /api/v1/characters/[id]/wardrobe - Get all wardrobe items for a character
 * POST /api/v1/characters/[id]/wardrobe - Create a new wardrobe item
 */

import { NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler, checkOwnership } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { notFound, serverError, created } from '@/lib/api/responses';
import { WardrobeItemTypeEnum } from '@/lib/schemas/wardrobe.types';

const createWardrobeItemSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().nullable().optional(),
  types: z.array(WardrobeItemTypeEnum).min(1, 'At least one type is required'),
  appropriateness: z.string().nullable().optional(),
  isDefault: z.boolean().optional(),
});

// GET /api/v1/characters/[id]/wardrobe
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      const character = await repos.characters.findById(id);

      if (!checkOwnership(character, user.id)) {
        return notFound('Character');
      }

      logger.debug('[Wardrobe v1] Fetching wardrobe items', { characterId: id });

      const wardrobeItems = await repos.wardrobe.findByCharacterId(id);
      return NextResponse.json({ wardrobeItems });
    } catch (error) {
      logger.error('[Wardrobe v1] Error fetching wardrobe items', { characterId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch wardrobe items');
    }
  }
);

// POST /api/v1/characters/[id]/wardrobe
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    const character = await repos.characters.findById(id);

    if (!checkOwnership(character, user.id)) {
      return notFound('Character');
    }

    const body = await req.json();
    const validatedData = createWardrobeItemSchema.parse(body);

    logger.debug('[Wardrobe v1] Creating wardrobe item', {
      characterId: id,
      title: validatedData.title,
      types: validatedData.types,
    });

    const item = await repos.wardrobe.create({
      characterId: id,
      title: validatedData.title,
      description: validatedData.description ?? null,
      types: validatedData.types,
      appropriateness: validatedData.appropriateness ?? null,
      isDefault: validatedData.isDefault ?? false,
      migratedFromClothingRecordId: null,
    });

    if (!item) {
      return serverError('Failed to create wardrobe item');
    }

    logger.info('[Wardrobe v1] Wardrobe item created', {
      characterId: id,
      itemId: item.id,
      title: validatedData.title,
    });

    return created({ wardrobeItem: item });
  }
);
