/**
 * Image Tags API Routes
 * POST /api/images/:id/tags - Add tag to image
 * DELETE /api/images/:id/tags - Remove tag from image
 *
 * Uses the repository pattern for metadata management.
 */

import { NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import { getRepositories } from '@/lib/repositories/factory';
import { notFound, forbidden, badRequest, serverError, validationError } from '@/lib/api/responses';
import { z } from 'zod';
import { logger } from '@/lib/logger';

const tagSchema = z.object({
  tagType: z.enum(['CHARACTER', 'PERSONA', 'CHAT', 'THEME']),
  tagId: z.string(),
});

/**
 * Verify that the tagged entity exists and belongs to the user
 */
async function verifyTaggedEntity(
  tagType: 'CHARACTER' | 'PERSONA' | 'CHAT' | 'THEME',
  tagId: string,
  userId: string
): Promise<NextResponse | null> {
  const repos = getRepositories();

  if (tagType === 'CHARACTER') {
    const character = await repos.characters.findById(tagId);
    if (!character) {
      logger.debug('Character not found', { characterId: tagId });
      return notFound('Character');
    }
    // Security: verify character belongs to user
    if (character.userId !== userId) {
      logger.warn('User tried to tag with character they do not own', { characterId: tagId, userId });
      return forbidden();
    }
  } else if (tagType === 'PERSONA') {
    const persona = await repos.personas.findById(tagId);
    if (!persona) {
      logger.debug('Persona not found', { personaId: tagId });
      return notFound('Persona');
    }
    // Security: verify persona belongs to user
    if (persona.userId !== userId) {
      logger.warn('User tried to tag with persona they do not own', { personaId: tagId, userId });
      return forbidden();
    }
  } else if (tagType === 'CHAT') {
    const chat = await repos.chats.findById(tagId);
    if (!chat) {
      logger.debug('Chat not found', { chatId: tagId });
      return notFound('Chat');
    }
    // Security: verify chat belongs to user
    if (chat.userId !== userId) {
      logger.warn('User tried to tag with chat they do not own', { chatId: tagId, userId });
      return forbidden();
    }
  }

  return null;
}

/**
 * POST /api/images/:id/tags
 * Add a tag to an image using the repository pattern
 */
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (request, { user, repos }, { id }) => {
    try {
      const body = await request.json();
      const { tagType, tagId } = tagSchema.parse(body);

      logger.debug('POST /api/images/:id/tags - Starting', {
        fileId: id,
        tagType,
        tagId,
        userId: user.id
      });

      // Find the file in repository
      const fileEntry = await repos.files.findById(id);

      if (!fileEntry) {
        logger.debug('File not found in repository', { fileId: id });
        return notFound('Image');
      }

      // Verify file belongs to the user
      if (fileEntry.userId !== user.id) {
        logger.warn('User tried to tag file they do not own', {
          fileId: id,
          userId: user.id,
          ownerId: fileEntry.userId
        });
        return forbidden();
      }

      // Verify file is an image
      if (fileEntry.category !== 'IMAGE') {
        logger.debug('File is not an image', {
          fileId: id,
          category: fileEntry.category
        });
        return badRequest('File is not an image');
      }

      // Verify the tagged entity exists and belongs to user
      const entityError = await verifyTaggedEntity(tagType, tagId, user.id);
      if (entityError) {
        return entityError;
      }

      // Check if tag already exists
      const alreadyTagged = fileEntry.tags && fileEntry.tags.includes(tagId);

      if (alreadyTagged) {
        logger.debug('File already has tag, returning success', {
          fileId: id,
          tagId,
          tagType
        });
        return NextResponse.json({
          data: {
            fileId: id,
            tagType,
            tagId,
            alreadyTagged: true,
          }
        });
      }

      // Add tag to file using repository
      try {
        await repos.files.addTag(id, tagId);
        logger.debug('Tag added to file', {
          fileId: id,
          tagId,
          tagType
        });
      } catch (err) {
        logger.error('Failed to add tag to file', {
          fileId: id,
          tagId,
          error: err instanceof Error ? err.message : String(err)
        });
        throw err;
      }

      return NextResponse.json({
        data: {
          fileId: id,
          tagType,
          tagId,
        }
      });
    } catch (error) {
      logger.error('Error adding tag:', error as Error);

      if (error instanceof z.ZodError) {
        return validationError(error);
      }

      return serverError('Failed to add tag');
    }
  }
);

/**
 * DELETE /api/images/:id/tags
 * Remove a tag from an image using the repository pattern
 */
export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (request, { user, repos }, { id }) => {
    try {
      const searchParams = request.nextUrl.searchParams;
      const tagType = searchParams.get('tagType') as 'CHARACTER' | 'PERSONA' | 'CHAT' | 'THEME' | null;
      const tagId = searchParams.get('tagId');

      if (!tagType || !tagId) {
        logger.debug('DELETE /api/images/:id/tags - Missing tagType or tagId');
        return badRequest('tagType and tagId are required');
      }

      logger.debug('DELETE /api/images/:id/tags - Starting', {
        fileId: id,
        tagType,
        tagId,
        userId: user.id
      });

      // Find the file in repository
      const fileEntry = await repos.files.findById(id);

      if (!fileEntry) {
        logger.debug('File not found in repository', { fileId: id });
        return notFound('Image');
      }

      // Verify file belongs to the user
      if (fileEntry.userId !== user.id) {
        logger.warn('User tried to remove tag from file they do not own', {
          fileId: id,
          userId: user.id,
          ownerId: fileEntry.userId
        });
        return forbidden();
      }

      // Remove the tag using repository
      try {
        await repos.files.removeTag(id, tagId);
        logger.debug('Tag removed from file', {
          fileId: id,
          tagId,
          tagType
        });
      } catch (err) {
        logger.error('Failed to remove tag from file', {
          fileId: id,
          tagId,
          error: err instanceof Error ? err.message : String(err)
        });
        throw err;
      }

      return NextResponse.json({ data: { success: true } });
    } catch (error) {
      logger.error('Error removing tag:', error as Error);
      return serverError('Failed to remove tag');
    }
  }
);
