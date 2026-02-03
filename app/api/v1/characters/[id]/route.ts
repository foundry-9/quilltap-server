/**
 * Characters API v1 - Individual Character Endpoint
 *
 * GET /api/v1/characters/[id] - Get a specific character
 * PUT /api/v1/characters/[id] - Update a character
 * DELETE /api/v1/characters/[id] - Delete a character (supports cascade)
 *
 * GET Actions:
 * - export - Export character
 * - chats - List recent chats with this character
 * - cascade-preview - Get cascade delete preview
 * - default-partner - Get default partner
 * - get-tags - Get character tags
 *
 * POST Actions:
 * - favorite - Toggle favorite
 * - avatar - Set avatar
 * - add-tag - Add tag
 * - remove-tag - Remove tag
 * - toggle-controlled-by - Toggle user/LLM control
 * - set-default-partner - Set default partner
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createAuthenticatedParamsHandler, checkOwnership, AuthenticatedContext } from '@/lib/api/middleware';
import { getFilePath } from '@/lib/api/middleware/file-path';
import { getActionParam } from '@/lib/api/middleware/actions';
import { executeCascadeDelete, getCascadeDeletePreview } from '@/lib/cascade-delete';
import { exportSTCharacter, createSTCharacterPNG } from '@/lib/sillytavern/character';
import { readImageBuffer } from '@/lib/images-v2';
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
  avatarUrl: z.url()
    .optional()
    .or(z.literal('')),
  defaultConnectionProfileId: z.uuid()
    .optional()
    .or(
      z.literal('').transform(() => undefined)
    ),
  defaultImageProfileId: z.uuid()
    .optional()
    .or(
      z.literal('').transform(() => undefined)
    )
    .nullable(),
  controlledBy: z.enum(['llm', 'user']).optional(),
  npc: z.boolean().optional(),
  defaultAgentModeEnabled: z.boolean().nullable().optional(),
});

const avatarSchema = z.object({
  imageId: z.string().nullable(),
});

const addTagSchema = z.object({
  tagId: z.uuid(),
});

const removeTagSchema = z.object({
  tagId: z.uuid(),
});

const setDefaultPartnerSchema = z.object({
  partnerId: z.uuid().nullable(),
});

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createAuthenticatedParamsHandler<{ id: string }>(async (req, { user, repos }, { id }) => {
  const action = getActionParam(req);

  // First verify ownership for all actions
  const character = await repos.characters.findById(id);
  if (!checkOwnership(character, user.id)) {
    return notFound('Character');
  }

  switch (action) {
    // Export character
    case 'export': {
      try {
        const { searchParams } = new URL(req.url);
        const format = searchParams.get('format') || 'json';

        if (format === 'png') {
          // Get avatar buffer if character has an avatar
          let avatarBuffer: Buffer | undefined;
          if (character.defaultImageId) {
            try {
              avatarBuffer = await readImageBuffer(character.defaultImageId);
            } catch (error) {
              logger.warn('[Characters v1] Could not read avatar for PNG export, using placeholder', {
                characterId: id,
                imageId: character.defaultImageId,
              });
              // Will use generated placeholder
            }
          }

          // Create PNG with embedded character data (uses placeholder if no avatar)
          const pngBuffer = await createSTCharacterPNG(character, avatarBuffer);

          return new NextResponse(new Uint8Array(pngBuffer), {
            headers: {
              'Content-Type': 'image/png',
              'Content-Disposition': `attachment; filename="${character.name}.png"`,
            },
          });
        } else {
          const stCharacter = exportSTCharacter(character);
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

    // List recent chats with this character
    case 'chats': {
      try {
        const { searchParams } = new URL(req.url);
        const search = searchParams.get('search')?.toLowerCase() || '';
        const limit = parseInt(searchParams.get('limit') || '10', 10);
        const offset = parseInt(searchParams.get('offset') || '0', 10);

        // Get chats with this character
        const allChats = await repos.chats.findByCharacterId(id);

        // Filter by user
        const userChats = allChats.filter((chat) => chat.userId === user.id);

        // Pre-fetch messages for search, enrichment, and sorting by last message
        const chatsWithMessages = await Promise.all(
          userChats.map(async (chat) => {
            const allMessages = await repos.chats.getMessages(chat.id);
            // Calculate the timestamp of the last message
            const messageTimestamps = allMessages
              .filter((msg) => msg.type === 'message')
              .map((msg) => new Date(msg.createdAt).getTime());
            const lastMessageAt = messageTimestamps.length > 0
              ? new Date(Math.max(...messageTimestamps)).toISOString()
              : chat.updatedAt; // Fallback to chat updatedAt if no messages
            return { chat, messages: allMessages, lastMessageAt };
          })
        );

        // Sort by last message timestamp descending
        chatsWithMessages.sort((a, b) =>
          new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
        );

        // Apply search filter if provided
        let filteredChats = chatsWithMessages;
        if (search) {
          filteredChats = chatsWithMessages.filter(({ chat, messages }) => {
            // Search in title
            if (chat.title?.toLowerCase().includes(search)) {
              return true;
            }
            // Search in message content
            return messages.some(msg =>
              msg.type === 'message' && msg.content.toLowerCase().includes(search)
            );
          });
        }

        // Apply pagination
        const paginatedChats = filteredChats.slice(offset, offset + limit);

        // Collect unique project IDs from chats
        const projectIds = new Set<string>();
        for (const { chat } of paginatedChats) {
          if (chat.projectId) {
            projectIds.add(chat.projectId);
          }
        }

        // Fetch all projects at once
        const projectMap = new Map<string, { id: string; name: string }>();
        for (const projectId of projectIds) {
          const project = await repos.projects.findById(projectId);
          if (project) {
            projectMap.set(projectId, { id: project.id, name: project.name });
          }
        }
        // Enrich chats with related data
        const enrichedChats = await Promise.all(
          paginatedChats.map(async ({ chat, messages, lastMessageAt }) => {
            // Get tags
            const tagData = await Promise.all(
              (chat.tags || []).map(async (tagId) => {
                const tag = await repos.tags.findById(tagId);
                return tag ? { tag: { id: tag.id, name: tag.name } } : null;
              })
            );

            // Get all messages and count them for badge
            const messageCount = messages.filter((msg) => msg.type === 'message').length;

            // Get last 3 messages for preview
            const recentMessages = messages
              .filter((msg) => msg.type === 'message')
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              .slice(0, 3)
              .map((msg) => ({
                id: msg.id,
                role: msg.role,
                content: msg.content,
                createdAt: msg.createdAt,
              }));

            // Get project info if chat belongs to a project
            const project = chat.projectId ? projectMap.get(chat.projectId) || null : null;

            return {
              id: chat.id,
              title: chat.title,
              createdAt: chat.createdAt,
              updatedAt: chat.updatedAt,
              lastMessageAt,
              character: {
                id: character.id,
                name: character.name,
              },
              project,
              messages: recentMessages,
              tags: tagData.filter((tag): tag is { tag: { id: string; name: string } } => tag !== null),
              _count: {
                messages: messageCount,
              },
            };
          })
        );

        return NextResponse.json({ chats: enrichedChats, total: filteredChats.length });
      } catch (error) {
        logger.error('[Characters v1] Error fetching character chats', { characterId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to fetch chats');
      }
    }

    // Get cascade delete preview
    case 'cascade-preview': {
      try {
        const preview = await getCascadeDeletePreview(id);

        if (!preview) {
          return serverError('Failed to generate preview');
        }

        return NextResponse.json({
          characterId: preview.characterId,
          characterName: preview.characterName,
          exclusiveChats: preview.exclusiveChats.map(c => ({
            id: c.chat.id,
            title: c.chat.title,
            messageCount: c.messageCount,
            lastMessageAt: c.chat.lastMessageAt,
          })),
          exclusiveCharacterImageCount: preview.exclusiveCharacterImages.length,
          exclusiveChatImageCount: preview.exclusiveChatImages.length,
          totalExclusiveImageCount:
            preview.exclusiveCharacterImages.length + preview.exclusiveChatImages.length,
          memoryCount: preview.memoryCount,
        });
      } catch (error) {
        logger.error('[Characters v1] Error generating cascade delete preview', { characterId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to generate preview');
      }
    }

    // Get default partner
    case 'default-partner': {
      try {
        return NextResponse.json({
          partnerId: character.defaultPartnerId || null,
        });
      } catch (error) {
        logger.error('[Characters v1] Error fetching default partner', { characterId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to fetch default partner');
      }
    }

    // Get character tags
    case 'get-tags': {
      try {
        // Get tag details for each tag ID
        const tagDetails = await Promise.all(
          (character.tags || []).map(async (tagId) => {
            const tag = await repos.tags.findById(tagId);
            return tag ? { id: tag.id, name: tag.name, visualStyle: tag.visualStyle } : null;
          })
        );

        // Filter out null values (tags that no longer exist)
        const validTags = tagDetails.filter(Boolean);

        return NextResponse.json({ tags: validTags });
      } catch (error) {
        logger.error('[Characters v1] Error fetching character tags', { characterId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to fetch character tags');
      }
    }

    // Default: get character
    default: {
      try {
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
    }
  }
});

// ============================================================================
// PUT Handler
// ============================================================================

export const PUT = createAuthenticatedParamsHandler<{ id: string }>(async (req, { user, repos }, { id }) => {
  try {
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

    case 'toggle-controlled-by': {
      try {
        // Toggle the controlledBy property
        const newControlledBy = character.controlledBy === 'user' ? 'llm' : 'user';
        const updatedCharacter = await repos.characters.setControlledBy(id, newControlledBy);

        logger.info('[Characters v1] ControlledBy toggled', { characterId: id, controlledBy: newControlledBy });

        return NextResponse.json({ character: updatedCharacter });
      } catch (error) {
        logger.error('[Characters v1] Error toggling controlledBy', { characterId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to toggle controlled-by');
      }
    }

    case 'set-default-partner': {
      try {
        const body = await req.json();
        const { partnerId } = setDefaultPartnerSchema.parse(body);

        // If partnerId is provided, verify it exists and is user-controlled
        if (partnerId) {
          const partner = await repos.characters.findById(partnerId);
          if (!partner || partner.userId !== user.id) {
            return notFound('Partner character');
          }
          if (partner.controlledBy !== 'user') {
            return badRequest('Partner must be a user-controlled character');
          }
          if (partnerId === id) {
            return badRequest('Character cannot be its own partner');
          }
        }

        await repos.characters.update(id, {
          defaultPartnerId: partnerId,
        });

        logger.info('[Characters v1] Default partner updated', {
          characterId: id,
          partnerId,
        });

        return NextResponse.json({
          partnerId,
          success: true,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return validationError(error);
        }
        logger.error('[Characters v1] Error updating default partner', { characterId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to update default partner');
      }
    }

    default:
      return badRequest(`Unknown action: ${action}. Available actions: favorite, avatar, add-tag, remove-tag, toggle-controlled-by, set-default-partner`);
  }
});
