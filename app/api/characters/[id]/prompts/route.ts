/**
 * Character System Prompts API
 *
 * GET /api/characters/[id]/prompts - Get all system prompts for a character
 * POST /api/characters/[id]/prompts - Add a new system prompt to a character
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { notFound, badRequest, serverError, validationError } from '@/lib/api/responses';

const createPromptSchema = z.object({
  name: z.string().min(1).max(100),
  content: z.string().min(1),
  isDefault: z.boolean().optional().default(false),
});

export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (request, { user, repos, session }, { id: characterId }) => {
    try {
      logger.debug('Fetching character prompts', { characterId, userId: user.id });

      const character = await repos.characters.findById(characterId);

      if (!character) {
        logger.warn('Character not found for prompts fetch', {
          characterId,
          userId: user.id,
        });
        return notFound('Character');
      }

      if (character.userId !== user.id) {
        logger.warn('Forbidden access to character prompts', {
          characterId,
          userId: user.id,
          ownerId: character.userId,
        });
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      const prompts = character.systemPrompts || [];
      logger.debug('Retrieved character prompts', {
        characterId,
        userId: user.id,
        count: prompts.length,
      });

      return NextResponse.json(prompts);
    } catch (error) {
      logger.error('Error fetching character prompts', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return serverError('Failed to fetch character prompts');
    }
  }
);

export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (request, { user, repos, session }, { id: characterId }) => {
    try {
      const body = await request.json();
      const validated = createPromptSchema.parse(body);

      logger.debug('Adding system prompt to character', {
        characterId,
        userId: user.id,
        promptName: validated.name,
        isDefault: validated.isDefault,
      });

      // First verify the character exists and belongs to the user
      const character = await repos.characters.findById(characterId);

      if (!character) {
        logger.warn('Character not found for adding prompt', {
          characterId,
          userId: user.id,
        });
        return notFound('Character');
      }

      if (character.userId !== user.id) {
        logger.warn('Forbidden attempt to add prompt to character', {
          characterId,
          userId: user.id,
          ownerId: character.userId,
        });
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      const prompt = await repos.characters.addSystemPrompt(characterId, {
        name: validated.name,
        content: validated.content,
        isDefault: validated.isDefault,
      });

      if (!prompt) {
        logger.error('Failed to add system prompt to character', {
          characterId,
          userId: user.id,
        });
        return serverError('Failed to add system prompt');
      }

      logger.info('System prompt added to character', {
        characterId,
        userId: user.id,
        promptId: prompt.id,
        promptName: validated.name,
      });

      return NextResponse.json(prompt, { status: 201 });
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.warn('Invalid character prompt data', { errors: error.errors });
        return validationError(error);
      }
      logger.error('Error adding character prompt', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return serverError('Failed to add character prompt');
    }
  }
);
