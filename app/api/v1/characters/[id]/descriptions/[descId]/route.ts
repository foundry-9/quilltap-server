/**
 * Character Description Detail API v1
 *
 * GET /api/v1/characters/[id]/descriptions/[descId] - Get a description
 * PUT /api/v1/characters/[id]/descriptions/[descId] - Update a description
 * DELETE /api/v1/characters/[id]/descriptions/[descId] - Delete a description
 */

import { createAuthenticatedParamsHandler, checkOwnership } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { notFound, serverError, validationError, successResponse } from '@/lib/api/responses';

const updateDescriptionSchema = z.object({
  name: z.string().min(1).optional(),
  usageContext: z.string().max(200).nullable().optional(),
  shortPrompt: z.string().max(350).nullable().optional(),
  mediumPrompt: z.string().max(500).nullable().optional(),
  longPrompt: z.string().max(750).nullable().optional(),
  completePrompt: z.string().max(1000).nullable().optional(),
  fullDescription: z.string().nullable().optional(),
});

// GET /api/v1/characters/[id]/descriptions/[descId]
export const GET = createAuthenticatedParamsHandler<{ id: string; descId: string }>(
  async (req, { user, repos }, { id, descId }) => {
    try {
      // Verify character exists and belongs to user
      const character = await repos.characters.findById(id);

      if (!checkOwnership(character, user.id)) {
        return notFound('Character');
      }

      const description = await repos.characters.getDescription(id, descId);

      if (!description) {
        return notFound('Description');
      }return successResponse({ description });
    } catch (error) {
      logger.error('[Characters v1] Error fetching character description', { characterId: id, descriptionId: descId }, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch character description');
    }
  }
);

// PUT /api/v1/characters/[id]/descriptions/[descId]
export const PUT = createAuthenticatedParamsHandler<{ id: string; descId: string }>(
  async (req, { user, repos }, { id, descId }) => {
    try {
      // Verify character exists and belongs to user
      const character = await repos.characters.findById(id);

      if (!checkOwnership(character, user.id)) {
        return notFound('Character');
      }

      const body = await req.json();
      const validatedData = updateDescriptionSchema.parse(body);

      const description = await repos.characters.updateDescription(id, descId, validatedData);

      if (!description) {
        return notFound('Description');
      }

      logger.info('[Characters v1] Description updated', {
        characterId: id,
        descriptionId: descId,
      });

      return successResponse({ description });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return validationError(error);
      }

      logger.error('[Characters v1] Error updating character description', { characterId: id, descriptionId: descId }, error instanceof Error ? error : undefined);
      return serverError('Failed to update character description');
    }
  }
);

// DELETE /api/v1/characters/[id]/descriptions/[descId]
export const DELETE = createAuthenticatedParamsHandler<{ id: string; descId: string }>(
  async (req, { user, repos }, { id, descId }) => {
    try {
      // Verify character exists and belongs to user
      const character = await repos.characters.findById(id);

      if (!checkOwnership(character, user.id)) {
        return notFound('Character');
      }

      const success = await repos.characters.removeDescription(id, descId);

      if (!success) {
        return notFound('Description');
      }

      logger.info('[Characters v1] Description deleted', {
        characterId: id,
        descriptionId: descId,
      });

      return successResponse({ success: true });
    } catch (error) {
      logger.error('[Characters v1] Error deleting character description', { characterId: id, descriptionId: descId }, error instanceof Error ? error : undefined);
      return serverError('Failed to delete character description');
    }
  }
);
