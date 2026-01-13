/**
 * Characters API v1 - Individual Character Endpoint
 *
 * GET /api/v1/characters/[id] - Get a specific character
 * PUT /api/v1/characters/[id] - Update a character
 * DELETE /api/v1/characters/[id] - Delete a character (supports cascade)
 * GET /api/v1/characters/[id]?action=export - Export character
 * POST /api/v1/characters/[id]?action=favorite - Toggle favorite
 * POST /api/v1/characters/[id]?action=avatar - Set avatar
 * POST /api/v1/characters/[id]?action=add-tag - Add tag
 * POST /api/v1/characters/[id]?action=remove-tag - Remove tag
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createAuthenticatedParamsHandler, checkOwnership, AuthenticatedContext } from '@/lib/api/middleware';
import { getFilePath } from '@/lib/api/middleware/file-path';
import { getActionParam } from '@/lib/api/middleware/actions';
import { executeCascadeDelete } from '@/lib/cascade-delete';
import { exportSTCharacter } from '@/lib/sillytavern/character';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { notFound, forbidden, badRequest, serverError, validationError } from '@/lib/api/responses';

// ============================================================================
// Schemas
// ============================================================================

const updateCharacterSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  personality: z.string().optional(),
  scenario: z.string().optional(),
  firstMessage: z.string().optional(),
  exampleDialogues: z.string().optional(),
  avatarUrl: z
    .string()
    .url()
    .optional()
    .or(z.literal('')),
  defaultConnectionProfileId: z
    .string()
    .uuid()
    .optional()
    .or(
      z.literal('').transform(() => undefined)
    ),
  controlledBy: z.enum(['llm', 'user']).optional(),
  npc: z.boolean().optional(),
});

const avatarSchema = z.object({
  imageId: z.string().nullable(),
});

const addTagSchema = z.object({
  tagId: z.string().uuid(),
});

const removeTagSchema = z.object({
  tagId: z.string().uuid(),
});

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createAuthenticatedParamsHandler<{ id: string }>(async (req, { user, repos }, { id }) => {
  const action = getActionParam(req);

  // Handle export action
  if (action === 'export') {
    try {
      const { searchParams } = new URL(req.url);
      const format = searchParams.get('format') || 'json';

      const character = await repos.characters.findById(id);

      if (!checkOwnership(character, user.id)) {
        return notFound('Character');
      }

      const stCharacter = exportSTCharacter(character);

      if (format === 'png') {
        if (!character.avatarUrl) {
          return badRequest('Character must have an avatar for PNG export');
        }

        // PNG export not yet implemented
        return NextResponse.json(
          {
            error: 'PNG export requires avatar storage implementation. Use JSON export for now.',
          },
          { status: 501 }
        );
      } else {
        return new NextResponse(JSON.stringify(stCharacter, null, 2), {
          headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="${character.name}.json"`,
          },
        });
      }
    } catch (error) {
      logger.error('[Characters v1] Error exporting character', { characterId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to export character');
    }
  }

  // Default: get character
  try {
    logger.debug('[Characters v1] GET character', { characterId: id, userId: user.id });

    const character = await repos.characters.findById(id);

    if (!checkOwnership(character, user.id)) {
      return notFound('Character');
    }

    // Get default image
    let defaultImage = null;
    if (character.defaultImageId) {
      const fileEntry = await repos.files.findById(character.defaultImageId);
      if (fileEntry) {
        defaultImage = {
          id: fileEntry.id,
          filepath: getFilePath(fileEntry),
          url: null,
        };
      }
    }

    // Get chat count
    const chats = await repos.chats.findByCharacterId(id);

    const enrichedCharacter = {
      ...character,
      defaultImage,
      _count: {
        chats: chats.length,
      },
    };

    return NextResponse.json({ character: enrichedCharacter });
  } catch (error) {
    logger.error('[Characters v1] Error fetching character', { characterId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch character');
  }
});

// ============================================================================
// PUT Handler
// ============================================================================

export const PUT = createAuthenticatedParamsHandler<{ id: string }>(async (req, { user, repos }, { id }) => {
  try {
    logger.debug('[Characters v1] PUT character', { characterId: id, userId: user.id });

    const existingCharacter = await repos.characters.findById(id);

    if (!checkOwnership(existingCharacter, user.id)) {
      return notFound('Character');
    }

    const body = await req.json();
    const validatedData = updateCharacterSchema.parse(body);

    const character = await repos.characters.update(id, validatedData);

    revalidatePath('/');

    logger.info('[Characters v1] Character updated', { characterId: id });

    return NextResponse.json({ character });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Characters v1] Error updating character', { characterId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to update character');
  }
});

// ============================================================================
// DELETE Handler
// ============================================================================

export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(async (req, { user, repos }, { id }) => {
  try {
    logger.debug('[Characters v1] DELETE character', { characterId: id, userId: user.id });

    const existingCharacter = await repos.characters.findById(id);

    if (!checkOwnership(existingCharacter, user.id)) {
      return notFound('Character');
    }

    // Parse cascade options
    const { searchParams } = new URL(req.url);
    const cascadeChats = searchParams.get('cascadeChats') === 'true';
    const cascadeImages = searchParams.get('cascadeImages') === 'true';

    const result = await executeCascadeDelete(id, {
      deleteExclusiveChats: cascadeChats,
      deleteExclusiveImages: cascadeImages,
    });

    if (!result.success) {
      return serverError('Failed to delete character');
    }

    logger.info('[Characters v1] Character deleted', {
      characterId: id,
      deletedChats: result.deletedChats,
      deletedImages: result.deletedImages,
      deletedMemories: result.deletedMemories,
    });

    return NextResponse.json({
      success: true,
      deletedChats: result.deletedChats,
      deletedImages: result.deletedImages,
      deletedMemories: result.deletedMemories,
    });
  } catch (error) {
    logger.error('[Characters v1] Error deleting character', { characterId: id }, error instanceof Error ? error : undefined);
    return serverError('Failed to delete character');
  }
});

// ============================================================================
// POST Handler - Actions
// ============================================================================

export const POST = createAuthenticatedParamsHandler<{ id: string }>(async (req, { user, repos }, { id }) => {
  const action = getActionParam(req);

  // Verify ownership first
  const character = await repos.characters.findById(id);
  if (!checkOwnership(character, user.id)) {
    return notFound('Character');
  }

  switch (action) {
    case 'favorite': {
      try {
        const updatedCharacter = await repos.characters.setFavorite(id, !character.isFavorite);
        logger.info('[Characters v1] Favorite toggled', {
          characterId: id,
          isFavorite: updatedCharacter?.isFavorite,
        });
        return NextResponse.json({ character: updatedCharacter });
      } catch (error) {
        logger.error('[Characters v1] Error toggling favorite', { characterId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to toggle favorite');
      }
    }

    case 'avatar': {
      try {
        const body = await req.json();
        const { imageId } = avatarSchema.parse(body);

        // Validate image if provided
        if (imageId) {
          const fileEntry = await repos.files.findById(imageId);

          if (!fileEntry) {
            return notFound('Image file');
          }

          if (fileEntry.userId !== user.id) {
            return notFound('Image file');
          }

          if (fileEntry.category !== 'IMAGE' && fileEntry.category !== 'AVATAR') {
            return badRequest(`Invalid file type. Expected IMAGE or AVATAR, got ${fileEntry.category}`);
          }
        }

        const updatedCharacter = await repos.characters.update(id, {
          defaultImageId: imageId,
        });

        // Build response with file info
        let defaultImage = null;
        if (updatedCharacter?.defaultImageId) {
          const fileEntry = await repos.files.findById(updatedCharacter.defaultImageId);
          if (fileEntry) {
            defaultImage = {
              id: fileEntry.id,
              filepath: getFilePath(fileEntry),
              url: null,
            };
          }
        }

        logger.info('[Characters v1] Avatar updated', {
          characterId: id,
          newImageId: imageId,
        });

        return NextResponse.json({
          data: {
            ...updatedCharacter,
            defaultImage,
          },
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return validationError(error);
        }
        logger.error('[Characters v1] Error updating avatar', { characterId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to update character avatar');
      }
    }

    case 'add-tag': {
      try {
        const body = await req.json();
        const validatedData = addTagSchema.parse(body);

        // Verify tag exists and belongs to user
        const tag = await repos.tags.findById(validatedData.tagId);

        if (!tag) {
          return notFound('Tag');
        }

        if (tag.userId !== user.id) {
          return forbidden();
        }

        await repos.characters.addTag(id, validatedData.tagId);

        logger.info('[Characters v1] Tag added', {
          characterId: id,
          tagId: validatedData.tagId,
        });

        return NextResponse.json({ success: true, tag }, { status: 201 });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return validationError(error);
        }
        logger.error('[Characters v1] Error adding tag', { characterId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to add tag to character');
      }
    }

    case 'remove-tag': {
      try {
        const body = await req.json();
        const validatedData = removeTagSchema.parse(body);

        await repos.characters.removeTag(id, validatedData.tagId);

        logger.info('[Characters v1] Tag removed', {
          characterId: id,
          tagId: validatedData.tagId,
        });

        return NextResponse.json({ success: true });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return validationError(error);
        }
        logger.error('[Characters v1] Error removing tag', { characterId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to remove tag from character');
      }
    }

    default:
      return badRequest(`Unknown action: ${action}. Available actions: favorite, avatar, add-tag, remove-tag`);
  }
});
