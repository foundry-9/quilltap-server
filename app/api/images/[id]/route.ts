/**
 * Individual Image API Routes
 * GET /api/images/:id - Get single image
 * DELETE /api/images/:id - Delete image
 *
 * Uses the repository pattern for metadata and S3 for file storage.
 */

import { NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import { getFilePath } from '@/lib/api/middleware/file-path';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { notFound, badRequest, serverError } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import type { FileEntry } from '@/lib/schemas/types';

/**
 * GET /api/images/:id
 * Get a single image by ID
 */
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (request, { user, repos }, { id }) => {
    try {
      logger.debug('GET /api/images/[id] - Fetching image', { imageId: id, userId: user.id });

      const image = await repos.files.findById(id);

      if (!image) {
        logger.debug('GET /api/images/[id] - Image not found', { imageId: id });
        return notFound('Image');
      }

      // Verify image belongs to user
      if (image.userId !== user.id) {
        logger.warn('GET /api/images/[id] - User tried to access image they do not own', {
          imageId: id,
          userId: user.id,
          ownerId: image.userId,
        });
        return notFound('Image');
      }

      // Verify file category
      if (image.category !== 'IMAGE' && image.category !== 'AVATAR') {
        logger.debug('GET /api/images/[id] - File is not an image', { imageId: id, category: image.category });
        return notFound('Image');
      }

      // Count usages by checking related entities
      const [allCharacters, allPersonas] = await Promise.all([
        repos.characters.findByUserId(user.id),
        repos.personas.findByUserId(user.id),
      ]);

      const charactersUsingAsDefault = allCharacters.filter(c => c.defaultImageId === id).length;
      const personasUsingAsDefault = allPersonas.filter(p => p.defaultImageId === id).length;
      const chatAvatarOverrides = allCharacters.reduce((count, c) => {
        return count + c.avatarOverrides.filter(o => o.imageId === id).length;
      }, 0);

      // Map source to old format
      const source = image.source === 'UPLOADED' ? 'upload' :
                     image.source === 'IMPORTED' ? 'import' :
                     image.source === 'GENERATED' ? 'generated' : 'upload';

      logger.debug('GET /api/images/[id] - Image fetched successfully', {
        imageId: id,
        filename: image.originalFilename,
        usageCount: charactersUsingAsDefault + personasUsingAsDefault + chatAvatarOverrides,
      });

      return NextResponse.json({
        data: {
          id: image.id,
          userId: user.id,
          filename: image.originalFilename,
          filepath: getFilePath(image),
          mimeType: image.mimeType,
          size: image.size,
          width: image.width,
          height: image.height,
          source,
          generationPrompt: image.generationPrompt,
          generationModel: image.generationModel,
          createdAt: image.createdAt,
          updatedAt: image.updatedAt,
          tags: image.tags,
          _count: {
            charactersUsingAsDefault,
            personasUsingAsDefault,
            chatAvatarOverrides,
          },
        }
      });
    } catch (error) {
      logger.error('Error fetching image:', { context: 'GET /api/images/[id]' }, error as Error);
      return serverError('Failed to fetch image');
    }
  }
);

/**
 * DELETE /api/images/:id
 * Delete an image
 */
export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (request, { user, repos }, { id }) => {
    try {
      logger.debug('DELETE /api/images/[id] - Deleting image', { imageId: id, userId: user.id });

      // Check if image exists
      const image = await repos.files.findById(id);

      if (!image) {
        logger.debug('DELETE /api/images/[id] - Image not found', { imageId: id });
        return notFound('Image');
      }

      // Verify image belongs to user
      if (image.userId !== user.id) {
        logger.warn('DELETE /api/images/[id] - User tried to delete image they do not own', {
          imageId: id,
          userId: user.id,
          ownerId: image.userId,
        });
        return notFound('Image');
      }

      // Verify file category
      if (image.category !== 'IMAGE' && image.category !== 'AVATAR') {
        logger.debug('DELETE /api/images/[id] - File is not an image', { imageId: id, category: image.category });
        return notFound('Image');
      }

      // Check if the underlying file actually exists in storage (to detect orphaned metadata)
      let fileExists = false;
      if (image.storageKey) {
        try {
          fileExists = await fileStorageManager.fileExists(image);
        } catch {
          logger.debug('DELETE /api/images/[id] - Storage file does not exist (orphaned)', { imageId: id, storageKey: image.storageKey });
        }
      }

      // Count usages by checking related entities
      const [allCharacters, allPersonas] = await Promise.all([
        repos.characters.findByUserId(user.id),
        repos.personas.findByUserId(user.id),
      ]);

      const charactersUsingAsDefault = allCharacters.filter(c => c.defaultImageId === id);
      const personasUsingAsDefault = allPersonas.filter(p => p.defaultImageId === id);
      const chatAvatarOverrides = allCharacters.reduce((acc, c) => {
        const overrides = c.avatarOverrides.filter(o => o.imageId === id);
        return overrides.length > 0 ? [...acc, { characterId: c.id, overrides }] : acc;
      }, [] as Array<{ characterId: string; overrides: Array<{ chatId: string; imageId: string }> }>);

      // Check if image is being used
      const isInUse =
        charactersUsingAsDefault.length > 0 ||
        personasUsingAsDefault.length > 0 ||
        chatAvatarOverrides.length > 0;

      // If the file is orphaned (doesn't exist), clean up references and allow deletion
      if (!fileExists && isInUse) {
        logger.info('DELETE /api/images/[id] - Cleaning up references to orphaned image', {
          imageId: id,
          charactersUsingAsDefault: charactersUsingAsDefault.length,
          personasUsingAsDefault: personasUsingAsDefault.length,
          chatAvatarOverrides: chatAvatarOverrides.length,
        });

        // Clear defaultImageId on characters
        for (const character of charactersUsingAsDefault) {
          await repos.characters.update(character.id, { defaultImageId: null });
          logger.debug('DELETE /api/images/[id] - Cleared defaultImageId on character', { characterId: character.id });
        }

        // Clear defaultImageId on personas
        for (const persona of personasUsingAsDefault) {
          await repos.personas.update(persona.id, { defaultImageId: null });
          logger.debug('DELETE /api/images/[id] - Cleared defaultImageId on persona', { personaId: persona.id });
        }

        // Clear avatar overrides
        for (const { characterId, overrides } of chatAvatarOverrides) {
          const character = allCharacters.find(c => c.id === characterId);
          if (character) {
            const updatedOverrides = character.avatarOverrides.filter(o => o.imageId !== id);
            await repos.characters.update(characterId, { avatarOverrides: updatedOverrides });
            logger.debug('DELETE /api/images/[id] - Cleared avatar overrides on character', { characterId, removedCount: overrides.length });
          }
        }
      } else if (isInUse) {
        // File exists and is in use - don't allow deletion
        logger.debug('DELETE /api/images/[id] - Image is in use, cannot delete', {
          imageId: id,
          charactersUsingAsDefault: charactersUsingAsDefault.length,
          personasUsingAsDefault: personasUsingAsDefault.length,
          chatAvatarOverrides: chatAvatarOverrides.length,
        });
        return badRequest('Image is in use', 'This image is currently being used as an avatar or in chat overrides. Please remove all usages before deleting.');
      }

      // Delete from storage if file has storageKey
      if (image.storageKey) {
        try {
          await fileStorageManager.deleteFile(image);
          logger.debug('DELETE /api/images/[id] - Deleted from storage', { imageId: id, storageKey: image.storageKey });
        } catch (storageError) {
          logger.warn('DELETE /api/images/[id] - Failed to delete from storage', {
            imageId: id,
            storageKey: image.storageKey,
            error: storageError instanceof Error ? storageError.message : 'Unknown error',
          });
          // Continue with metadata deletion even if storage deletion fails
        }
      }

      // Delete file metadata from repository
      const deleted = await repos.files.delete(id);

      if (!deleted) {
        logger.warn('DELETE /api/images/[id] - Failed to delete file metadata', { imageId: id });
        return serverError('Failed to delete image');
      }

      logger.debug('DELETE /api/images/[id] - Image deleted successfully', {
        imageId: id,
        filename: image.originalFilename,
      });

      return NextResponse.json({ data: { success: true } });
    } catch (error) {
      logger.error('Error deleting image:', { context: 'DELETE /api/images/[id]' }, error as Error);
      return serverError('Failed to delete image');
    }
  }
);
