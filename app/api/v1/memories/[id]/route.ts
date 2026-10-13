/**
 * Memories API v1 - Individual Memory Endpoint
 *
 * GET /api/v1/memories/[id] - Get a specific memory
 * PUT /api/v1/memories/[id] - Update a memory
 * DELETE /api/v1/memories/[id] - Delete a memory
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler } from '@/lib/api/middleware';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { badRequest, errorResponse, notFound, serverError } from '@/lib/api/responses';
import { scheduleRefit, handleEntityDeletion } from '@/lib/embedding/embedding-job-scheduler';
import { retireMemories } from '@/lib/memory/retire';
import { updateMemory } from '@/lib/memory/admission';

// Validation schema for updating a memory
const updateMemorySchema = z.object({
  content: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  keywords: z.array(z.string()).optional(),
  tags: z.array(z.uuid()).optional(),
  importance: z.number().min(0).max(1).optional(),
  aboutCharacterId: z.uuid().nullable().optional(),
  chatId: z.uuid().nullable().optional(),
  relatedMemoryIds: z.array(z.uuid()).optional(),
});

/**
 * GET /api/v1/memories/[id] - Get a specific memory
 */
export const GET = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id: memoryId }) => {
    try {// Find the memory - need to check ownership via character
      const memory = await repos.memories.findById(memoryId);
      if (!memory) {
        return notFound('Memory');
      }

      // Verify ownership via character
      const character = await repos.characters.findById(memory.characterId);
      if (!character) {
        return notFound('Memory'); // Return 404 instead of 403 to not leak existence
      }

      // Enrich with tag names
      const allTags = await repos.tags.findAll();
      const tagMap = new Map(allTags.map((t: any) => [t.id, t]));

      const memoryWithTags = {
        ...memory,
        tagDetails: memory.tags
          .map((tagId: string) => tagMap.get(tagId))
          .filter(Boolean),
      };

      // Viewing a memory is not an access (bug 219, refactor decision 7):
      // `lastAccessedAt` records that a model was shown the row, and it feeds
      // protection's recent-access bonus and housekeeping's inactivity clock.
      // An operator's or script's inspection must not move either.
      logger.debug('[Memories API v1] Fetched memory (access time not stamped)', {
        memoryId,
        characterId: memory.characterId,
      });

      return NextResponse.json({ memory: memoryWithTags });
    } catch (error) {
      logger.error('[Memories API v1] Error fetching memory', {}, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch memory');
    }
  }
);

/**
 * PUT /api/v1/memories/[id] - Update a memory
 */
export const PUT = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id: memoryId }) => {
    // Find the memory
    const existingMemory = await repos.memories.findById(memoryId);
    if (!existingMemory) {
      return notFound('Memory');
    }

    // Verify ownership via character
    const character = await repos.characters.findById(existingMemory.characterId);
    if (!character) {
      return notFound('Memory');
    }

    const body = await req.json();
    const validatedData = updateMemorySchema.parse(body);

    // Through the edit chokepoint, not a raw row update: it re-embeds changed
    // text, recomputes reinforcedImportance, links both sides, invalidates the
    // frozen archive, publishes `memories` and refreshes a digest's
    // Commonplace mirror (bug 203).
    const result = await updateMemory(existingMemory.characterId, memoryId, validatedData, {
      userId: user.id,
    });

    if (!result.ok) {
      if (result.reason === 'embedding-failed') {
        // The provider could not embed the new text; nothing was saved.
        logger.warn('[Memories API v1] Memory edit refused: embedding failed', {
          memoryId,
          characterId: existingMemory.characterId,
          error: result.message,
        });
        return errorResponse(
          `The memory was not saved because its new text could not be embedded. ${result.message}`,
          502
        );
      }
      if (result.reason === 'invalid-related') {
        return badRequest(
          `relatedMemoryIds must name existing memories of the same character: ${result.invalidIds.join(', ')}`
        );
      }
      return notFound('Memory');
    }
    const memory = result.memory;

    logger.debug('[Memories API v1] Memory updated', {
      memoryId,
      characterId: existingMemory.characterId,
      fields: Object.keys(validatedData),
    });

    // Schedule refit for BUILTIN profiles (non-blocking)
    scheduleRefit(user.id).catch((err: Error) =>
      logger.warn('[Memories API v1] Failed to schedule refit after update', {
        memoryId,
        error: err.message,
      })
    );

    return NextResponse.json({ memory });
  }
);

/**
 * DELETE /api/v1/memories/[id] - Delete a memory
 */
export const DELETE = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id: memoryId }) => {
    try {// Find the memory
      const existingMemory = await repos.memories.findById(memoryId);
      if (!existingMemory) {
        return notFound('Memory');
      }

      // Verify ownership via character
      const character = await repos.characters.findById(existingMemory.characterId);
      if (!character) {
        return notFound('Memory');
      }

      // The deletion chokepoint removes the row, scrubs every link that names
      // it and evicts its vector (bug 200: an orphan vector blinded the gate).
      const { retired } = await retireMemories([memoryId], { reason: 'item-delete' });
      if (retired === 0) {
        return notFound('Memory');
      }

      // Clean up embedding status (non-blocking)
      handleEntityDeletion('MEMORY', memoryId).catch((err: Error) =>
        logger.warn('[Memories API v1] Failed to handle entity deletion', {
          memoryId,
          error: err.message,
        })
      );

      // Schedule refit for BUILTIN profiles (non-blocking)
      scheduleRefit(user.id).catch((err: Error) =>
        logger.warn('[Memories API v1] Failed to schedule refit after delete', {
          memoryId,
          error: err.message,
        })
      );

      logger.info('[Memories API v1] Memory deleted', {
        memoryId,
        characterId: existingMemory.characterId,
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error('[Memories API v1] Error deleting memory', {}, error instanceof Error ? error : undefined);
      return serverError('Failed to delete memory');
    }
  }
);
