/**
 * Chat Avatar Overrides API Routes
 * GET /api/chats/:id/avatars - Get avatar overrides for a chat
 * POST /api/chats/:id/avatars - Set avatar override for a character in this chat
 * DELETE /api/chats/:id/avatars - Remove avatar override
 *
 * Avatar overrides are stored on the Character entity in the avatarOverrides array,
 * not in a separate images table.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler, getFilePath } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { notFound, badRequest, serverError, validationError } from '@/lib/api/responses';

const avatarOverrideSchema = z.object({
  characterId: z.string(),
  imageId: z.string(),
});

/**
 * GET /api/chats/:id/avatars
 * Get all avatar overrides for a chat
 */
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (request: NextRequest, { user, repos }, { id }) => {
    try {
      // Verify chat exists and belongs to user
      const chat = await repos.chats.findById(id);

      if (!chat || chat.userId !== user.id) {
        return notFound('Chat');
      }

      // Get all characters that have avatar overrides for this chat
      const allCharacters = await repos.characters.findByUserId(user.id);

      // Collect avatar overrides from all characters for this chat
      const enrichedOverrides = await Promise.all(
        allCharacters.flatMap(character =>
          (character.avatarOverrides || [])
            .filter(override => override.chatId === id)
            .map(async (override) => {
              const fileEntry = await repos.files.findById(override.imageId);
              return {
                chatId: id,
                characterId: character.id,
                imageId: override.imageId,
                character: { id: character.id, name: character.name },
                image: fileEntry ? {
                  id: fileEntry.id,
                  filepath: getFilePath(fileEntry),
                  url: null,
                } : null,
              };
            })
        )
      );

      return NextResponse.json({ data: enrichedOverrides });
    } catch (error) {
      logger.error('Error fetching avatar overrides', { endpoint: '/api/chats/[id]/avatars', method: 'GET' }, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch avatar overrides');
    }
  }
);

/**
 * POST /api/chats/:id/avatars
 * Set avatar override for a character in this chat
 */
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (request: NextRequest, { user, repos }, { id }) => {
    try {
      const body = await request.json();
      const { characterId, imageId } = avatarOverrideSchema.parse(body);

      // Verify chat exists and belongs to user
      const chat = await repos.chats.findById(id);

      if (!chat || chat.userId !== user.id) {
        return notFound('Chat');
      }

      // Verify character exists and belongs to user
      const character = await repos.characters.findById(characterId);

      if (!character || character.userId !== user.id) {
        return notFound('Character');
      }

      // Verify image exists in repository and belongs to user
      const fileEntry = await repos.files.findById(imageId);

      if (!fileEntry || fileEntry.userId !== user.id) {
        return notFound('Image');
      }

      // Update character's avatarOverrides array
      const existingOverrides = character.avatarOverrides || [];
      const overrideIndex = existingOverrides.findIndex(o => o.chatId === id);

      let updatedOverrides;
      if (overrideIndex >= 0) {
        // Update existing override
        updatedOverrides = [...existingOverrides];
        updatedOverrides[overrideIndex] = { chatId: id, imageId };
      } else {
        // Add new override
        updatedOverrides = [...existingOverrides, { chatId: id, imageId }];
      }

      await repos.characters.update(characterId, { avatarOverrides: updatedOverrides });

      const override = {
        chatId: id,
        characterId,
        imageId,
        character: { id: character.id, name: character.name },
        image: {
          id: fileEntry.id,
          filepath: getFilePath(fileEntry),
          url: null,
        },
      };

      return NextResponse.json({ data: override });
    } catch (error) {
      logger.error('Error setting avatar override', { endpoint: '/api/chats/[id]/avatars', method: 'POST' }, error instanceof Error ? error : undefined);

      if (error instanceof z.ZodError) {
        return validationError(error);
      }

      return serverError('Failed to set avatar override');
    }
  }
);

/**
 * DELETE /api/chats/:id/avatars
 * Remove avatar override for a character in this chat
 */
export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (request: NextRequest, { user, repos }, { id }) => {
    try {
      const searchParams = request.nextUrl.searchParams;
      const characterId = searchParams.get('characterId');

      if (!characterId) {
        return badRequest('characterId is required');
      }

      // Verify chat exists and belongs to user
      const chat = await repos.chats.findById(id);

      if (!chat || chat.userId !== user.id) {
        return notFound('Chat');
      }

      // Verify character exists and belongs to user
      const character = await repos.characters.findById(characterId);

      if (!character || character.userId !== user.id) {
        return notFound('Character');
      }

      // Remove avatar override from character's avatarOverrides array
      const existingOverrides = character.avatarOverrides || [];
      const updatedOverrides = existingOverrides.filter(o => o.chatId !== id);

      await repos.characters.update(characterId, { avatarOverrides: updatedOverrides });

      return NextResponse.json({ data: { success: true } });
    } catch (error) {
      logger.error('Error removing avatar override', { endpoint: '/api/chats/[id]/avatars', method: 'DELETE' }, error instanceof Error ? error : undefined);
      return serverError('Failed to remove avatar override');
    }
  }
);
