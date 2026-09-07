/**
 * Character Subprompts API v1
 *
 * GET  /api/v1/characters/[id]/subprompts - List the character's subprompts
 *      (`Subprompts/*.md` in the vault). A missing folder lists as empty.
 * POST /api/v1/characters/[id]/subprompts - Create a subprompt; creates the
 *      `Subprompts/` folder on first use.
 */

import { z } from 'zod';
import { createContextParamsHandler, exists } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { notFound, serverError, created, successResponse, conflict, badRequest } from '@/lib/api/responses';
import { publishRealtime } from '@/lib/realtime/bus';
import { CharacterArchivedError } from '@/lib/database/repositories/characters.repository';
import {
  listCharacterSubprompts,
  createCharacterSubprompt,
  SubpromptValidationError,
  SUBPROMPT_TITLE_MAX_LENGTH,
} from '@/lib/subprompts/subprompts';

const createSubpromptSchema = z.object({
  title: z.string().min(1).max(SUBPROMPT_TITLE_MAX_LENGTH),
  content: z.string().min(1),
});

// GET /api/v1/characters/[id]/subprompts
export const GET = createContextParamsHandler<{ id: string }>(
  async (_request, { repos }, { id: characterId }) => {
    try {
      const character = await repos.characters.findByIdRaw(characterId);
      if (!exists(character)) {
        return notFound('Character');
      }
      const subprompts = await listCharacterSubprompts(characterId);
      logger.debug('[Characters v1] Listed subprompts', { characterId, count: subprompts.length });
      return successResponse({ subprompts });
    } catch (error) {
      logger.error('[Characters v1] Error listing subprompts', { characterId }, error instanceof Error ? error : undefined);
      return serverError('Failed to list subprompts');
    }
  }
);

// POST /api/v1/characters/[id]/subprompts
export const POST = createContextParamsHandler<{ id: string }>(
  async (request, { user, repos }, { id: characterId }) => {
    const body = await request.json();
    const validated = createSubpromptSchema.parse(body);

    const character = await repos.characters.findByIdRaw(characterId);
    if (!exists(character)) {
      return notFound('Character');
    }

    try {
      const subprompt = await createCharacterSubprompt(characterId, validated);
      logger.info('[Characters v1] Subprompt created', {
        characterId,
        userId: user.id,
        subpromptId: subprompt.id,
      });
      publishRealtime('characters', characterId);
      return created({ subprompt });
    } catch (error) {
      if (error instanceof CharacterArchivedError) {
        return conflict('Character is archived; subprompts cannot be added');
      }
      if (error instanceof SubpromptValidationError) {
        return badRequest(error.message);
      }
      logger.error('[Characters v1] Error creating subprompt', { characterId }, error instanceof Error ? error : undefined);
      return serverError('Failed to create subprompt');
    }
  }
);
