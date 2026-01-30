/**
 * Tags API v1 - Individual Tag Endpoint
 *
 * GET /api/v1/tags/[id] - Get tag details
 * PUT /api/v1/tags/[id] - Update tag
 * DELETE /api/v1/tags/[id] - Delete tag
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler, checkOwnership } from '@/lib/api/middleware';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { notFound, validationError, serverError, successResponse, badRequest } from '@/lib/api/responses';
import { TagVisualStyleSchema } from '@/lib/schemas/common.types';

// ============================================================================
// Schemas
// ============================================================================

const updateTagSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  quickHide: z.boolean().optional(),
  visualStyle: TagVisualStyleSchema.nullable().optional(),
});

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createAuthenticatedParamsHandler<{ id: string }>(async (req, { user, repos }, { id }) => {
  try {

    const tag = await repos.tags.findById(id);

    if (!checkOwnership(tag, user.id)) {
      return notFound('Tag');
    }

    // Get usage counts
    const allCharacters = await repos.characters.findAll();
    const allChats = await repos.chats.findAll();
    const allConnections = await repos.connections.findAll();

    const characterTags = allCharacters.filter(c => c.tags.includes(tag.id)).length;
    const chatTags = allChats.filter(c => c.tags.includes(tag.id)).length;
    const connectionProfileTags = allConnections.filter(c => c.tags.includes(tag.id)).length;

    const enrichedTag = {
      ...tag,
      _count: {
        characterTags,
        chatTags,
        connectionProfileTags,
      },
    };


    return successResponse({ tag: enrichedTag });
  } catch (error) {
    logger.error('[Tags v1] Error fetching tag', { tagId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch tag');
  }
});

// ============================================================================
// PUT Handler
// ============================================================================

export const PUT = createAuthenticatedParamsHandler<{ id: string }>(async (req, { user, repos }, { id }) => {
  try {

    const existingTag = await repos.tags.findById(id);

    if (!checkOwnership(existingTag, user.id)) {
      return notFound('Tag');
    }

    const body = await req.json();
    const validatedData = updateTagSchema.parse(body);

    // If name is being changed, ensure it doesn't conflict
    if (validatedData.name && validatedData.name !== existingTag.name) {
      const existingByName = await repos.tags.findByName(user.id, validatedData.name);
      if (existingByName && existingByName.id !== id) {
        return badRequest('A tag with this name already exists');
      }
    }

    // Update - the repository will automatically handle nameLower if name is provided
    const tag = await repos.tags.update(id, validatedData);

    logger.info('[Tags v1] Tag updated', { tagId: id, userId: user.id });

    return successResponse({ tag });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Tags v1] Error updating tag', { tagId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to update tag');
  }
});

// ============================================================================
// DELETE Handler
// ============================================================================

export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(async (req, { user, repos }, { id }) => {
  try {

    const existingTag = await repos.tags.findById(id);

    if (!checkOwnership(existingTag, user.id)) {
      return notFound('Tag');
    }

    // Remove this tag from all entities that reference it
    const allCharacters = await repos.characters.findAll();
    for (const character of allCharacters) {
      if (character.tags.includes(id)) {
        const updatedTags = character.tags.filter((t: string) => t !== id);
        await repos.characters.update(character.id, { tags: updatedTags });
      }
    }

    const allChats = await repos.chats.findAll();
    for (const chat of allChats) {
      if (chat.tags.includes(id)) {
        const updatedTags = chat.tags.filter((t: string) => t !== id);
        await repos.chats.update(chat.id, { tags: updatedTags });
      }
    }

    const allConnections = await repos.connections.findAll();
    for (const connection of allConnections) {
      if (connection.tags.includes(id)) {
        const updatedTags = connection.tags.filter((t: string) => t !== id);
        await repos.connections.update(connection.id, { tags: updatedTags });
      }
    }

    // Delete the tag
    await repos.tags.delete(id);

    logger.info('[Tags v1] Tag deleted', { tagId: id, userId: user.id });

    return successResponse({ success: true });
  } catch (error) {
    logger.error('[Tags v1] Error deleting tag', { tagId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to delete tag');
  }
});
