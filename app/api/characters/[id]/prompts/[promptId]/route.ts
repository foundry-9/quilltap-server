/**
 * Individual Character System Prompt API
 *
 * GET /api/characters/[id]/prompts/[promptId] - Get a specific system prompt
 * PUT /api/characters/[id]/prompts/[promptId] - Update a system prompt
 * DELETE /api/characters/[id]/prompts/[promptId] - Delete a system prompt
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { notFound, badRequest, serverError, validationError } from '@/lib/api/responses';

const updatePromptSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  content: z.string().min(1).optional(),
  isDefault: z.boolean().optional(),
});

export const GET = createAuthenticatedParamsHandler<{ id: string; promptId: string }>(
  async (request, { user, repos }, { id: characterId, promptId }) => {
    try {
      logger.debug('Fetching character system prompt', {
        characterId,
        promptId,
        userId: user.id,
      });

      const character = await repos.characters.findById(characterId);

      if (!character) {
        logger.warn('Character not found for prompt fetch', {
          characterId,
          userId: user.id,
        });
        return notFound('Character');
      }

      if (character.userId !== user.id) {
        logger.warn('Forbidden access to character prompt', {
          characterId,
          userId: user.id,
          ownerId: character.userId,
        });
        return badRequest('Forbidden');
      }

      const prompt = character.systemPrompts?.find((p) => p.id === promptId);

      if (!prompt) {
        logger.warn('System prompt not found on character', {
          characterId,
          promptId,
          userId: user.id,
        });
        return notFound('Prompt');
      }

      logger.debug('Retrieved character system prompt', {
        characterId,
        promptId,
        userId: user.id,
      });

      return NextResponse.json(prompt);
    } catch (error) {
      logger.error('Error fetching character system prompt', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return serverError('Failed to fetch character prompt');
    }
  }
);

export const PUT = createAuthenticatedParamsHandler<{ id: string; promptId: string }>(
  async (request, { user, repos }, { id: characterId, promptId }) => {
    try {
      const body = await request.json();
      const validated = updatePromptSchema.parse(body);

      logger.debug('Updating character system prompt', {
        characterId,
        promptId,
        userId: user.id,
      });

      // Verify character exists and belongs to user
      const character = await repos.characters.findById(characterId);

      if (!character) {
        logger.warn('Character not found for prompt update', {
          characterId,
          userId: user.id,
        });
        return notFound('Character');
      }

      if (character.userId !== user.id) {
        logger.warn('Forbidden attempt to update character prompt', {
          characterId,
          userId: user.id,
          ownerId: character.userId,
        });
        return badRequest('Forbidden');
      }

      // Verify prompt exists
      const existingPrompt = character.systemPrompts?.find((p) => p.id === promptId);
      if (!existingPrompt) {
        logger.warn('System prompt not found for update', {
          characterId,
          promptId,
          userId: user.id,
        });
        return notFound('Prompt');
      }

      const updates: Record<string, unknown> = {};
      if (validated.name !== undefined) updates.name = validated.name;
      if (validated.content !== undefined) updates.content = validated.content;
      if (validated.isDefault !== undefined) updates.isDefault = validated.isDefault;

      const prompt = await repos.characters.updateSystemPrompt(characterId, promptId, updates);

      if (!prompt) {
        logger.error('Failed to update system prompt', {
          characterId,
          promptId,
          userId: user.id,
        });
        return serverError('Failed to update system prompt');
      }

      logger.info('Character system prompt updated', {
        characterId,
        promptId,
        userId: user.id,
        updatedFields: Object.keys(updates),
      });

      return NextResponse.json(prompt);
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.warn('Invalid character prompt update data', { errors: error.errors });
        return validationError(error);
      }
      logger.error('Error updating character system prompt', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return serverError('Failed to update character prompt');
    }
  }
);

export const DELETE = createAuthenticatedParamsHandler<{ id: string; promptId: string }>(
  async (request, { user, repos }, { id: characterId, promptId }) => {
    try {
      logger.debug('Deleting character system prompt', {
        characterId,
        promptId,
        userId: user.id,
      });

      // Verify character exists and belongs to user
      const character = await repos.characters.findById(characterId);

      if (!character) {
        logger.warn('Character not found for prompt deletion', {
          characterId,
          userId: user.id,
        });
        return notFound('Character');
      }

      if (character.userId !== user.id) {
        logger.warn('Forbidden attempt to delete character prompt', {
          characterId,
          userId: user.id,
          ownerId: character.userId,
        });
        return badRequest('Forbidden');
      }

      // Verify prompt exists
      const existingPrompt = character.systemPrompts?.find((p) => p.id === promptId);
      if (!existingPrompt) {
        logger.warn('System prompt not found for deletion', {
          characterId,
          promptId,
          userId: user.id,
        });
        return notFound('Prompt');
      }

      const deleted = await repos.characters.deleteSystemPrompt(characterId, promptId);

      if (!deleted) {
        logger.error('Failed to delete system prompt', {
          characterId,
          promptId,
          userId: user.id,
        });
        return serverError('Failed to delete system prompt');
      }

      logger.info('Character system prompt deleted', {
        characterId,
        promptId,
        userId: user.id,
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error('Error deleting character system prompt', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return serverError('Failed to delete character prompt');
    }
  }
);
