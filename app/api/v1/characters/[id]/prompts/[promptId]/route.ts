/**
 * Individual Character System Prompt API v1
 *
 * GET /api/v1/characters/[id]/prompts/[promptId] - Get a specific system prompt
 * PUT /api/v1/characters/[id]/prompts/[promptId] - Update a system prompt
 * DELETE /api/v1/characters/[id]/prompts/[promptId] - Delete a system prompt
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAuthenticatedParamsHandler, checkOwnership } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { notFound, serverError, validationError } from '@/lib/api/responses';

const updatePromptSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  content: z.string().min(1).optional(),
  isDefault: z.boolean().optional(),
});

// GET /api/v1/characters/[id]/prompts/[promptId]
export const GET = createAuthenticatedParamsHandler<{ id: string; promptId: string }>(
  async (request, { user, repos }, { id: characterId, promptId }) => {
    try {
      logger.debug('[Characters v1] Fetching character system prompt', {
        characterId,
        promptId,
        userId: user.id,
      });

      const character = await repos.characters.findById(characterId);

      if (!checkOwnership(character, user.id)) {
        return notFound('Character');
      }

      const prompt = character.systemPrompts?.find((p) => p.id === promptId);

      if (!prompt) {
        logger.warn('[Characters v1] System prompt not found on character', {
          characterId,
          promptId,
          userId: user.id,
        });
        return notFound('Prompt');
      }

      logger.debug('[Characters v1] Retrieved character system prompt', {
        characterId,
        promptId,
      });

      return NextResponse.json({ prompt });
    } catch (error) {
      logger.error('[Characters v1] Error fetching character system prompt', { characterId, promptId }, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch character prompt');
    }
  }
);

// PUT /api/v1/characters/[id]/prompts/[promptId]
export const PUT = createAuthenticatedParamsHandler<{ id: string; promptId: string }>(
  async (request, { user, repos }, { id: characterId, promptId }) => {
    try {
      const body = await request.json();
      const validated = updatePromptSchema.parse(body);

      logger.debug('[Characters v1] Updating character system prompt', {
        characterId,
        promptId,
        userId: user.id,
      });

      // Verify character exists and belongs to user
      const character = await repos.characters.findById(characterId);

      if (!checkOwnership(character, user.id)) {
        return notFound('Character');
      }

      // Verify prompt exists
      const existingPrompt = character.systemPrompts?.find((p) => p.id === promptId);
      if (!existingPrompt) {
        logger.warn('[Characters v1] System prompt not found for update', {
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
        logger.error('[Characters v1] Failed to update system prompt', {
          characterId,
          promptId,
          userId: user.id,
        });
        return serverError('Failed to update system prompt');
      }

      logger.info('[Characters v1] Character system prompt updated', {
        characterId,
        promptId,
        updatedFields: Object.keys(updates),
      });

      return NextResponse.json({ prompt });
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.warn('[Characters v1] Invalid character prompt update data', { errors: error.errors });
        return validationError(error);
      }
      logger.error('[Characters v1] Error updating character system prompt', { characterId, promptId }, error instanceof Error ? error : undefined);
      return serverError('Failed to update character prompt');
    }
  }
);

// DELETE /api/v1/characters/[id]/prompts/[promptId]
export const DELETE = createAuthenticatedParamsHandler<{ id: string; promptId: string }>(
  async (request, { user, repos }, { id: characterId, promptId }) => {
    try {
      logger.debug('[Characters v1] Deleting character system prompt', {
        characterId,
        promptId,
        userId: user.id,
      });

      // Verify character exists and belongs to user
      const character = await repos.characters.findById(characterId);

      if (!checkOwnership(character, user.id)) {
        return notFound('Character');
      }

      // Verify prompt exists
      const existingPrompt = character.systemPrompts?.find((p) => p.id === promptId);
      if (!existingPrompt) {
        logger.warn('[Characters v1] System prompt not found for deletion', {
          characterId,
          promptId,
          userId: user.id,
        });
        return notFound('Prompt');
      }

      const deleted = await repos.characters.deleteSystemPrompt(characterId, promptId);

      if (!deleted) {
        logger.error('[Characters v1] Failed to delete system prompt', {
          characterId,
          promptId,
          userId: user.id,
        });
        return serverError('Failed to delete system prompt');
      }

      logger.info('[Characters v1] Character system prompt deleted', {
        characterId,
        promptId,
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error('[Characters v1] Error deleting character system prompt', { characterId, promptId }, error instanceof Error ? error : undefined);
      return serverError('Failed to delete character prompt');
    }
  }
);
