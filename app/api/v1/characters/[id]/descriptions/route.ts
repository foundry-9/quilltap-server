/**
 * Character Descriptions API v1
 *
 * GET /api/v1/characters/[id]/descriptions - Get all descriptions for a character
 * POST /api/v1/characters/[id]/descriptions - Create a new description
 */

import { createAuthenticatedParamsHandler, checkOwnership } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { notFound, serverError, validationError, created, successResponse } from '@/lib/api/responses';

const createDescriptionSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  usageContext: z.string().max(200).nullable().optional(),
  shortPrompt: z.string().max(350).nullable().optional(),
  mediumPrompt: z.string().max(500).nullable().optional(),
  longPrompt: z.string().max(750).nullable().optional(),
  completePrompt: z.string().max(1000).nullable().optional(),
  fullDescription: z.string().nullable().optional(),
});

// GET /api/v1/characters/[id]/descriptions
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      // Verify character exists and belongs to user
      const character = await repos.characters.findById(id);

      if (!checkOwnership(character, user.id)) {
        return notFound('Character');
      }

      const descriptions = await repos.characters.getDescriptions(id);return successResponse({ descriptions });
    } catch (error) {
      logger.error('[Characters v1] Error fetching character descriptions', { characterId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch character descriptions');
    }
  }
);

// POST /api/v1/characters/[id]/descriptions
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      // Verify character exists and belongs to user
      const character = await repos.characters.findById(id);

      if (!checkOwnership(character, user.id)) {
        return notFound('Character');
      }

      const body = await req.json();
      const validatedData = createDescriptionSchema.parse(body);

      const description = await repos.characters.addDescription(id, validatedData);

      if (!description) {
        return serverError('Failed to create description');
      }

      logger.info('[Characters v1] Description created', {
        characterId: id,
        descriptionId: description.id,
        name: validatedData.name,
      });

      return created({ description });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return validationError(error);
      }

      logger.error('[Characters v1] Error creating character description', { characterId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to create character description');
    }
  }
);
