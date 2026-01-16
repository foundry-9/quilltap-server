/**
 * Chat File API Routes (v1)
 *
 * POST /api/v1/chat-files/:id?action=tag - Tag a chat file with CHARACTER
 * DELETE /api/v1/chat-files/:id - Delete a chat file
 *
 * Uses the repository pattern for metadata and S3 for file storage.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler, type AuthenticatedContext } from '@/lib/api/middleware';
import { withActionDispatch } from '@/lib/api/middleware/actions';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { notFound, badRequest, serverError, unauthorized, validationError, successResponse } from '@/lib/api/responses';
import { fileStorageManager } from '@/lib/file-storage/manager';

const tagSchema = z.object({
  tagType: z.literal('CHARACTER'),
  tagId: z.string(),
});

/**
 * Handle POST ?action=tag
 * Tag a chat file with a CHARACTER
 */
async function handleTag(
  request: NextRequest,
  ctx: AuthenticatedContext,
  params: { id: string }
): Promise<NextResponse> {
  const { id } = params;
  const { user, repos } = ctx;

  const body = await request.json();
  const parseResult = tagSchema.safeParse(body);

  if (!parseResult.success) {
    return validationError(parseResult.error);
  }

  const { tagType, tagId } = parseResult.data;

  logger.debug('POST /api/v1/chat-files/[id]?action=tag - Tagging file', {
    fileId: id,
    tagType,
    tagId,
    userId: user.id,
  });

  // Get the file from the repository
  const fileEntry = await repos.files.findById(id);

  if (!fileEntry) {
    logger.debug('POST /api/v1/chat-files/[id]?action=tag - File not found', { fileId: id });
    return notFound('File');
  }

  // Verify file belongs to user
  if (fileEntry.userId !== user.id) {
    logger.debug('POST /api/v1/chat-files/[id]?action=tag - File does not belong to user', {
      fileId: id,
      fileUserId: fileEntry.userId,
      sessionUserId: user.id,
    });
    return unauthorized();
  }

  // Verify the file is linked to a chat
  const chatId = fileEntry.linkedTo.find((linkId: string) => linkId.startsWith('chat-') || linkId.length === 36);
  if (!chatId) {
    logger.debug('POST /api/v1/chat-files/[id]?action=tag - File not linked to a chat', {
      fileId: id,
      linkedTo: fileEntry.linkedTo,
    });
    return badRequest('File is not associated with a chat');
  }

  // Verify chat belongs to user
  const chat = await repos.chats.findById(chatId);
  if (!chat || chat.userId !== user.id) {
    logger.debug('POST /api/v1/chat-files/[id]?action=tag - Chat does not belong to user', {
      fileId: id,
      chatId,
      chatExists: !!chat,
      chatUserId: chat?.userId,
      sessionUserId: user.id,
    });
    return unauthorized();
  }

  // Verify the tagged entity exists and belongs to user
  const character = await repos.characters.findById(tagId);
  if (!character || character.userId !== user.id) {
    logger.debug('POST /api/v1/chat-files/[id]?action=tag - Character not found or unauthorized', {
      fileId: id,
      tagId,
      characterExists: !!character,
      characterUserId: character?.userId,
      sessionUserId: user.id,
    });
    return notFound('Character');
  }
  logger.debug('POST /api/v1/chat-files/[id]?action=tag - Character verified', {
    fileId: id,
    characterId: tagId,
    characterName: character.name,
  });

  // Check if tag already exists on this file
  const alreadyTagged = fileEntry.tags.includes(tagId);
  if (alreadyTagged) {
    logger.debug('POST /api/v1/chat-files/[id]?action=tag - File already tagged', {
      fileId: id,
      tagType,
      tagId,
    });
    return NextResponse.json({
      data: {
        fileId: id,
        tagType,
        tagId,
        alreadyTagged: true,
      },
    });
  }

  // Add the tag to the file using repository
  logger.debug('POST /api/v1/chat-files/[id]?action=tag - Adding tag to file', {
    fileId: id,
    tagType,
    tagId,
  });
  const updatedFileEntry = await repos.files.addTag(id, tagId);

  logger.debug('POST /api/v1/chat-files/[id]?action=tag - Tag added successfully', {
    fileId: id,
    tagType,
    tagId,
    updatedTags: updatedFileEntry?.tags,
  });

  return NextResponse.json({
    data: {
      fileId: id,
      tagType,
      tagId,
    },
  });
}

/**
 * POST /api/v1/chat-files/:id
 * With ?action=tag - Tag a chat file
 */
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  withActionDispatch(
    {
      tag: handleTag,
    },
    // Default handler when no action specified - require action
    async () => badRequest('Action parameter required: tag')
  )
);

/**
 * DELETE /api/v1/chat-files/:id
 * Delete a chat file and its physical file
 */
export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (request: NextRequest, ctx, params) => {
    const { id } = params;
    const { user, repos } = ctx;

    try {
      logger.debug('DELETE /api/v1/chat-files/[id] - Deleting file', {
        fileId: id,
        userId: user.id,
      });

      // Get the file from repository
      const fileEntry = await repos.files.findById(id);

      if (!fileEntry) {
        logger.debug('DELETE /api/v1/chat-files/[id] - File not found', { fileId: id });
        return notFound('File');
      }

      // Verify file belongs to user
      if (fileEntry.userId !== user.id) {
        logger.debug('DELETE /api/v1/chat-files/[id] - File does not belong to user', {
          fileId: id,
          fileUserId: fileEntry.userId,
          sessionUserId: user.id,
        });
        return unauthorized();
      }

      // Verify the file is linked to a chat
      const chatId = fileEntry.linkedTo.find((linkId: string) => linkId.startsWith('chat-') || linkId.length === 36);
      if (!chatId) {
        logger.debug('DELETE /api/v1/chat-files/[id] - File not linked to a chat', {
          fileId: id,
          linkedTo: fileEntry.linkedTo,
        });
        return badRequest('File is not associated with a chat');
      }

      // Verify chat belongs to user
      const chat = await repos.chats.findById(chatId);
      if (!chat || chat.userId !== user.id) {
        logger.debug('DELETE /api/v1/chat-files/[id] - Chat does not belong to user', {
          fileId: id,
          chatId,
          chatExists: !!chat,
          chatUserId: chat?.userId,
          sessionUserId: user.id,
        });
        return unauthorized();
      }

      // Delete from storage if file has storageKey
      if (fileEntry.storageKey) {
        try {
          await fileStorageManager.deleteFile(fileEntry);
          logger.debug('DELETE /api/v1/chat-files/[id] - Deleted from storage', {
            fileId: id,
            storageKey: fileEntry.storageKey,
          });
        } catch (storageError) {
          logger.warn('DELETE /api/v1/chat-files/[id] - Failed to delete from storage', {
            fileId: id,
            storageKey: fileEntry.storageKey,
            error: storageError instanceof Error ? storageError.message : 'Unknown error',
          });
          // Continue with metadata deletion even if storage deletion fails
        }
      }

      // Delete the file metadata from repository
      logger.debug('DELETE /api/v1/chat-files/[id] - Deleting file metadata', {
        fileId: id,
        filename: fileEntry.originalFilename,
      });
      const deleted = await repos.files.delete(id);

      if (!deleted) {
        logger.debug('DELETE /api/v1/chat-files/[id] - File metadata not found', { fileId: id });
        return notFound('File');
      }

      logger.debug('DELETE /api/v1/chat-files/[id] - File deleted successfully', {
        fileId: id,
        filename: fileEntry.originalFilename,
      });

      return successResponse({ success: true });
    } catch (error) {
      logger.error(
        'Error deleting file',
        { context: 'DELETE /api/v1/chat-files/[id]' },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to delete file');
    }
  }
);
