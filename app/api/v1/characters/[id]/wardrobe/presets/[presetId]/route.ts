/**
 * Character Outfit Preset Detail API v1
 *
 * GET /api/v1/characters/[id]/wardrobe/presets/[presetId] - Get a preset
 * PUT /api/v1/characters/[id]/wardrobe/presets/[presetId] - Update a preset
 * DELETE /api/v1/characters/[id]/wardrobe/presets/[presetId] - Delete a preset
 * POST /api/v1/characters/[id]/wardrobe/presets/[presetId]?action=apply - Apply preset to a chat
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler, checkOwnership } from '@/lib/api/middleware';
import { withActionDispatch } from '@/lib/api/middleware/actions';
import type { RequestContext } from '@/lib/api/middleware/auth';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { notFound, serverError, badRequest } from '@/lib/api/responses';
import { EquippedSlotsSchema, WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types';
import type { EquippedSlots } from '@/lib/schemas/wardrobe.types';

const updatePresetSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  slots: EquippedSlotsSchema.optional(),
});

const applyPresetSchema = z.object({
  chatId: z.string().min(1, 'chatId is required'),
});

// GET /api/v1/characters/[id]/wardrobe/presets/[presetId]
export const GET = createAuthenticatedParamsHandler<{ id: string; presetId: string }>(
  async (req, { user, repos }, { id, presetId }) => {
    try {
      const character = await repos.characters.findById(id);

      if (!checkOwnership(character, user.id)) {
        return notFound('Character');
      }

      const preset = await repos.outfitPresets.findById(presetId);

      if (!preset || preset.characterId !== id) {
        return notFound('Outfit preset');
      }

      logger.debug('[Outfit Presets v1] Fetched preset', { characterId: id, presetId });

      return NextResponse.json({ preset });
    } catch (error) {
      logger.error(
        '[Outfit Presets v1] Error fetching preset',
        { characterId: id, presetId },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to fetch outfit preset');
    }
  }
);

// PUT /api/v1/characters/[id]/wardrobe/presets/[presetId]
export const PUT = createAuthenticatedParamsHandler<{ id: string; presetId: string }>(
  async (req, { user, repos }, { id, presetId }) => {
    const character = await repos.characters.findById(id);

    if (!checkOwnership(character, user.id)) {
      return notFound('Character');
    }

    const existing = await repos.outfitPresets.findById(presetId);
    if (!existing || existing.characterId !== id) {
      return notFound('Outfit preset');
    }

    const body = await req.json();
    const validatedData = updatePresetSchema.parse(body);

    logger.debug('[Outfit Presets v1] Updating preset', {
      characterId: id,
      presetId,
      fields: Object.keys(validatedData),
    });

    const preset = await repos.outfitPresets.update(presetId, validatedData);

    if (!preset) {
      return notFound('Outfit preset');
    }

    logger.info('[Outfit Presets v1] Preset updated', { characterId: id, presetId });

    return NextResponse.json({ preset });
  }
);

// DELETE /api/v1/characters/[id]/wardrobe/presets/[presetId]
export const DELETE = createAuthenticatedParamsHandler<{ id: string; presetId: string }>(
  async (req, { user, repos }, { id, presetId }) => {
    try {
      const character = await repos.characters.findById(id);

      if (!checkOwnership(character, user.id)) {
        return notFound('Character');
      }

      const existing = await repos.outfitPresets.findById(presetId);
      if (!existing || existing.characterId !== id) {
        return notFound('Outfit preset');
      }

      const success = await repos.outfitPresets.delete(presetId);

      if (!success) {
        return notFound('Outfit preset');
      }

      logger.info('[Outfit Presets v1] Preset deleted', { characterId: id, presetId });

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error(
        '[Outfit Presets v1] Error deleting preset',
        { characterId: id, presetId },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to delete outfit preset');
    }
  }
);

// POST /api/v1/characters/[id]/wardrobe/presets/[presetId]?action=apply
async function handleApply(
  req: NextRequest,
  { user, repos }: RequestContext,
  { id, presetId }: { id: string; presetId: string }
) {
  const character = await repos.characters.findById(id);

  if (!checkOwnership(character, user.id)) {
    return notFound('Character');
  }

  const preset = await repos.outfitPresets.findById(presetId);
  if (!preset || preset.characterId !== id) {
    return notFound('Outfit preset');
  }

  const body = await req.json();
  const { chatId } = applyPresetSchema.parse(body);

  // Verify the chat exists
  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return badRequest('Chat not found');
  }

  logger.debug('[Outfit Presets v1] Applying preset to chat', {
    characterId: id,
    presetId,
    chatId,
  });

  let resultSlots: EquippedSlots | null = null;

  for (const slot of WARDROBE_SLOT_TYPES) {
    const itemId = preset.slots[slot];
    if (itemId !== null && itemId !== undefined) {
      resultSlots = await repos.chats.updateEquippedSlot(chatId, id, slot, itemId);
    }
  }

  // If no slots were set in the preset, get the current state
  if (!resultSlots) {
    resultSlots = await repos.chats.getEquippedOutfitForCharacter(chatId, id);
  }

  logger.info('[Outfit Presets v1] Preset applied to chat', {
    characterId: id,
    presetId,
    chatId,
  });

  return NextResponse.json({ equipped: resultSlots });
}

export const POST = createAuthenticatedParamsHandler<{ id: string; presetId: string }>(
  withActionDispatch<{ id: string; presetId: string }>({
    apply: handleApply,
  })
);
