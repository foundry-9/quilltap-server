/**
 * Character Scenarios API v1
 *
 * GET /api/v1/characters/[id]/scenarios - Get all scenarios for a character.
 *     Archived scenarios are omitted unless `?includeArchived=true`.
 * POST /api/v1/characters/[id]/scenarios - Add a new scenario to a character
 * PUT /api/v1/characters/[id]/scenarios?scenarioId=xxx - Update a scenario
 * DELETE /api/v1/characters/[id]/scenarios?scenarioId=xxx - Remove a scenario
 *
 * Writes are per item (one file each) and ids are stable: the id a POST
 * returns is the id every later GET returns, and a title change keeps it.
 * The filtering is a RESPONSE filter only: `character.scenarios` itself always
 * carries the archived entries.
 */

import { z } from 'zod';
import { createContextParamsHandler, exists } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { successResponse, notFound, serverError, badRequest, created } from '@/lib/api/responses';
import { readIncludeArchived } from '@/lib/api/query-params';
import { publishRealtime } from '@/lib/realtime/bus';
import { CharacterArchivedError } from '@/lib/characters/archive-guard';

const createScenarioSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  description: z.string().max(500).optional(),
  archived: z.boolean().optional(),
});

const updateScenarioSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).optional(),
  description: z.string().max(500).optional(),
  archived: z.boolean().optional(),
});

// GET /api/v1/characters/[id]/scenarios
export const GET = createContextParamsHandler<{ id: string }>(
  async (request, { user, repos }, { id: characterId }) => {
    try {
      const character = await repos.characters.findById(characterId);

      if (!exists(character)) {
        return notFound('Character');
      }

      const all = character.scenarios || [];
      const scenarios = readIncludeArchived(request)
        ? all
        : all.filter((s) => s.archived !== true);
      return successResponse({ scenarios });
    } catch (error) {
      logger.error('[Characters v1] Error fetching character scenarios', { characterId }, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch character scenarios');
    }
  }
);

// POST /api/v1/characters/[id]/scenarios
export const POST = createContextParamsHandler<{ id: string }>(
  async (request, { user, repos }, { id: characterId }) => {
    const body = await request.json();
    const validated = createScenarioSchema.parse(body);

    const character = await repos.characters.findByIdRaw(characterId);

    if (!exists(character)) {
      return notFound('Character');
    }

    const scenario = await repos.characters.addScenario(characterId, {
      title: validated.title,
      content: validated.content,
      ...(validated.description !== undefined && { description: validated.description }),
      ...(validated.archived !== undefined && { archived: validated.archived }),
    });

    if (!scenario) {
      logger.error('[Characters v1] Failed to add scenario to character', {
        characterId,
        userId: user.id,
      });
      return serverError('Failed to add scenario');
    }

    logger.info('[Characters v1] Scenario added to character', {
      characterId,
      userId: user.id,
      scenarioId: scenario.id,
      scenarioTitle: validated.title,
    });

    publishRealtime('characters', characterId);
    return created({ scenario });
  }
);

// PUT /api/v1/characters/[id]/scenarios?scenarioId=xxx
export const PUT = createContextParamsHandler<{ id: string }>(
  async (request, { user, repos }, { id: characterId }) => {
    const url = new URL(request.url);
    const scenarioId = url.searchParams.get('scenarioId');

    if (!scenarioId) {
      return badRequest('scenarioId query parameter is required');
    }

    const body = await request.json();
    const validated = updateScenarioSchema.parse(body);

    const character = await repos.characters.findByIdRaw(characterId);

    if (!exists(character)) {
      return notFound('Character');
    }

    const updated = await repos.characters.updateScenario(characterId, scenarioId, validated);

    if (!updated) {
      return notFound('Scenario');
    }

    logger.info('[Characters v1] Scenario updated on character', {
      characterId,
      userId: user.id,
      scenarioId,
    });

    publishRealtime('characters', characterId);
    return successResponse({ scenario: updated });
  }
);

// DELETE /api/v1/characters/[id]/scenarios?scenarioId=xxx
export const DELETE = createContextParamsHandler<{ id: string }>(
  async (request, { user, repos }, { id: characterId }) => {
    try {
      const url = new URL(request.url);
      const scenarioId = url.searchParams.get('scenarioId');

      if (!scenarioId) {
        return badRequest('scenarioId query parameter is required');
      }

      const character = await repos.characters.findByIdRaw(characterId);

      if (!exists(character)) {
        return notFound('Character');
      }

      const removed = await repos.characters.removeScenario(characterId, scenarioId);

      if (!removed) {
        return notFound('Scenario');
      }

      // A default that names a scenario no longer there would pre-select
      // nothing in the New Chat dialog; clear it with the scenario.
      if (character.defaultScenarioId === scenarioId) {
        await repos.characters.update(characterId, { defaultScenarioId: null });
        logger.debug('[Characters v1] Cleared default scenario with its scenario', { characterId, scenarioId });
      }

      logger.info('[Characters v1] Scenario removed from character', {
        characterId,
        userId: user.id,
        scenarioId,
      });

      publishRealtime('characters', characterId);
      return successResponse({ message: 'Scenario removed' });
    } catch (error) {
      if (error instanceof CharacterArchivedError) throw error;
      logger.error('[Characters v1] Error removing character scenario', {}, error instanceof Error ? error : undefined);
      return serverError('Failed to remove character scenario');
    }
  }
);
