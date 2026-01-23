/**
 * Character System Prompts API v1
 *
 * GET /api/v1/characters/[id]/prompts - Get all system prompts for a character
 * POST /api/v1/characters/[id]/prompts - Add a new system prompt to a character
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAuthenticatedParamsHandler, checkOwnership } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { notFound, serverError, validationError, created } from '@/lib/api/responses';

const createPromptSchema = z.object({
  name: z.string().min(1).max(100),
  content: z.string().min(1),
  isDefault: z.boolean().optional().default(false),
});

// GET /api/v1/characters/[id]/prompts
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (request, { user, repos }, { id: characterId }) => {
    try {
      logger.debug('[Characters v1] Fetching character prompts', { characterId, userId: user.id });

      const character = await repos.characters.findById(characterId);

      if (!checkOwnership(character, user.id)) {
        return notFound('Character');
      }

      const prompts = character.systemPrompts || [];

      logger.debug('[Characters v1] Retrieved character prompts', {
        characterId,
        count: prompts.length,
      });

      return NextResponse.json({ prompts });
    } catch (error) {
      logger.error('[Characters v1] Error fetching character prompts', { characterId }, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch character prompts');
    }
  }
);

// POST /api/v1/characters/[id]/prompts
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (request, { user, repos }, { id: characterId }) => {
    try {
      const body = await request.json();
      const validated = createPromptSchema.parse(body);

      logger.debug('[Characters v1] Adding system prompt to character', {
        characterId,
        userId: user.id,
        promptName: validated.name,
        isDefault: validated.isDefault,
      });

      // First verify the character exists and belongs to the user
      const character = await repos.characters.findById(characterId);

      if (!checkOwnership(character, user.id)) {
        return notFound('Character');
      }

      const prompt = await repos.characters.addSystemPrompt(characterId, {
        name: validated.name,
        content: validated.content,
        isDefault: validated.isDefault,
      });

      if (!prompt) {
        logger.error('[Characters v1] Failed to add system prompt to character', {
          characterId,
          userId: user.id,
        });
        return serverError('Failed to add system prompt');
      }

      logger.info('[Characters v1] System prompt added to character', {
        characterId,
        userId: user.id,
        promptId: prompt.id,
        promptName: validated.name,
      });

      return created({ prompt });
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.warn('[Characters v1] Invalid character prompt data', { errors: error.errors });
        return validationError(error);
      }
      logger.error('[Characters v1] Error adding character prompt', {}, error instanceof Error ? error : undefined);
      return serverError('Failed to add character prompt');
    }
  }
);
