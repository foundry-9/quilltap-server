/**
 * Character Outfit Presets API v1
 *
 * GET /api/v1/characters/[id]/wardrobe/presets - List presets for a character
 * POST /api/v1/characters/[id]/wardrobe/presets - Create a new preset
 */

import { NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler, checkOwnership } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { notFound, serverError, created } from '@/lib/api/responses';
import { EquippedSlotsSchema } from '@/lib/schemas/wardrobe.types';

const createPresetSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().nullable().optional(),
  slots: EquippedSlotsSchema,
});

// GET /api/v1/characters/[id]/wardrobe/presets
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      const character = await repos.characters.findById(id);

      if (!checkOwnership(character, user.id)) {
        return notFound('Character');
      }

      logger.debug('[Outfit Presets v1] Fetching presets', { characterId: id });

      const presets = await repos.outfitPresets.findByCharacterId(id);
      return NextResponse.json({ presets });
    } catch (error) {
      logger.error(
        '[Outfit Presets v1] Error fetching presets',
        { characterId: id },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to fetch outfit presets');
    }
  }
);

// POST /api/v1/characters/[id]/wardrobe/presets
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    const character = await repos.characters.findById(id);

    if (!checkOwnership(character, user.id)) {
      return notFound('Character');
    }

    const body = await req.json();
    const validatedData = createPresetSchema.parse(body);

    logger.debug('[Outfit Presets v1] Creating preset', {
      characterId: id,
      name: validatedData.name,
    });

    const preset = await repos.outfitPresets.create({
      characterId: id,
      name: validatedData.name,
      description: validatedData.description ?? null,
      slots: validatedData.slots,
    });

    if (!preset) {
      return serverError('Failed to create outfit preset');
    }

    logger.info('[Outfit Presets v1] Preset created', {
      characterId: id,
      presetId: preset.id,
      name: validatedData.name,
    });

    return created({ preset });
  }
);
