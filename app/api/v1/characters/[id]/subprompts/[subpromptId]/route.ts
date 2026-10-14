/**
 * Individual Character Subprompt API v1
 *
 * GET    /api/v1/characters/[id]/subprompts/[subpromptId] - Read one subprompt
 * PUT    /api/v1/characters/[id]/subprompts/[subpromptId] - Update title/content;
 *        every chat with the subprompt in play recompiles its cached prompt
 * DELETE /api/v1/characters/[id]/subprompts/[subpromptId] - Delete; the id is
 *        struck from every seat that had it in play, which then recompiles
 *
 * `subpromptId` is the vault file name sans `.md`.
 */

import { z } from 'zod';
import { createContextParamsHandler, exists } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { notFound, serverError, successResponse, conflict, badRequest } from '@/lib/api/responses';
import { publishRealtime } from '@/lib/realtime/bus';
import { CharacterArchivedError } from '@/lib/database/repositories/characters.repository';
import {
  readCharacterSubprompt,
  updateCharacterSubprompt,
  deleteCharacterSubprompt,
  isValidSubpromptId,
  SubpromptNotFoundError,
  SubpromptValidationError,
  SUBPROMPT_TITLE_MAX_LENGTH,
} from '@/lib/subprompts/subprompts';
import { fanOutSubpromptChange } from '@/lib/subprompts/chat-fanout';

const updateSubpromptSchema = z.object({
  title: z.string().min(1).max(SUBPROMPT_TITLE_MAX_LENGTH).optional(),
  content: z.string().min(1).optional(),
});

type Params = { id: string; subpromptId: string };

// GET /api/v1/characters/[id]/subprompts/[subpromptId]
export const GET = createContextParamsHandler<Params>(
  async (_request, { repos }, { id: characterId, subpromptId }) => {
    try {
      if (!isValidSubpromptId(subpromptId)) {
        return badRequest('Invalid subprompt id');
      }
      const character = await repos.characters.findByIdRaw(characterId);
      if (!exists(character)) {
        return notFound('Character');
      }
      const subprompt = await readCharacterSubprompt(characterId, subpromptId);
      if (!subprompt) {
        return notFound('Subprompt');
      }
      return successResponse({ subprompt });
    } catch (error) {
      logger.error('[Characters v1] Error reading subprompt', { characterId, subpromptId }, error instanceof Error ? error : undefined);
      return serverError('Failed to read subprompt');
    }
  }
);

// PUT /api/v1/characters/[id]/subprompts/[subpromptId]
export const PUT = createContextParamsHandler<Params>(
  async (request, { user, repos }, { id: characterId, subpromptId }) => {
    const body = await request.json();
    const validated = updateSubpromptSchema.parse(body);
    if (!isValidSubpromptId(subpromptId)) {
      return badRequest('Invalid subprompt id');
    }
    const character = await repos.characters.findByIdRaw(characterId);
    if (!exists(character)) {
      return notFound('Character');
    }

    try {
      const subprompt = await updateCharacterSubprompt(characterId, subpromptId, validated);
      const fanout = await fanOutSubpromptChange(characterId, subpromptId);
      logger.info('[Characters v1] Subprompt updated', {
        characterId,
        userId: user.id,
        subpromptId,
        updatedFields: Object.keys(validated),
        ...fanout,
      });
      publishRealtime('characters', characterId);
      return successResponse({ subprompt });
    } catch (error) {
      if (error instanceof CharacterArchivedError) {
        return conflict('Character is archived; subprompts cannot be edited');
      }
      if (error instanceof SubpromptNotFoundError) {
        return notFound('Subprompt');
      }
      if (error instanceof SubpromptValidationError) {
        return badRequest(error.message);
      }
      logger.error('[Characters v1] Error updating subprompt', { characterId, subpromptId }, error instanceof Error ? error : undefined);
      return serverError('Failed to update subprompt');
    }
  }
);

// DELETE /api/v1/characters/[id]/subprompts/[subpromptId]
export const DELETE = createContextParamsHandler<Params>(
  async (_request, { user, repos }, { id: characterId, subpromptId }) => {
    if (!isValidSubpromptId(subpromptId)) {
      return badRequest('Invalid subprompt id');
    }
    const character = await repos.characters.findByIdRaw(characterId);
    if (!exists(character)) {
      return notFound('Character');
    }

    try {
      const deleted = await deleteCharacterSubprompt(characterId, subpromptId);
      if (!deleted) {
        return notFound('Subprompt');
      }
      const fanout = await fanOutSubpromptChange(characterId, subpromptId, { removeSelection: true });
      logger.info('[Characters v1] Subprompt deleted', {
        characterId,
        userId: user.id,
        subpromptId,
        ...fanout,
      });
      publishRealtime('characters', characterId);
      return successResponse({ success: true });
    } catch (error) {
      if (error instanceof CharacterArchivedError) {
        return conflict('Character is archived; subprompts cannot be deleted');
      }
      logger.error('[Characters v1] Error deleting subprompt', { characterId, subpromptId }, error instanceof Error ? error : undefined);
      return serverError('Failed to delete subprompt');
    }
  }
);
