/**
 * File Serving API Route
 *
 * Serves files from the centralized file storage (local filesystem or S3).
 * GET /api/files/:id - Retrieve a file by ID
 * DELETE /api/files/:id - Delete a file by ID
 */

import { NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { notFound, badRequest, serverError, forbidden } from '@/lib/api/responses';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { getFileAssociations } from '@/lib/files/get-file-associations';
import { getUserRepositories } from '@/lib/repositories/factory';
import type { FileEntry } from '@/lib/schemas/file.types';
import type { RepositoryContainer } from '@/lib/repositories/factory';

/**
 * Build Content-Disposition header value with proper Unicode support
 * Uses RFC 5987 encoding for non-ASCII filenames
 */
function buildContentDisposition(filename: string, disposition: 'inline' | 'attachment' = 'inline'): string {
  // Check if filename contains non-ASCII characters
  const hasNonAscii = /[^\x00-\x7F]/.test(filename);

  if (!hasNonAscii) {
    // Simple ASCII filename
    return `${disposition}; filename="${filename}"`;
  }

  // For non-ASCII filenames, use RFC 5987 encoding
  // Include both filename (ASCII fallback) and filename* (UTF-8 encoded)
  const asciiFilename = filename.replace(/[^\x00-\x7F]/g, '_');
  const encodedFilename = encodeURIComponent(filename);

  return `${disposition}; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`;
}

/**
 * GET /api/files/:id
 * Retrieve a file by its ID from S3 storage
 */
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (_request, { repos }, { id: fileId }) => {
    try {
      // Get file metadata from repository
      const fileEntry = await repos.files.findById(fileId);
      if (!fileEntry) {
        logger.debug('File not found', { context: 'GET /api/files/[id]', fileId });
        return notFound('File');
      }

      if (!fileEntry.storageKey) {
        logger.error('File has no storage key - may need migration', { context: 'GET /api/files/[id]', fileId });
        return serverError('File not available - migration required');
      }

      logger.debug('Serving file from storage', { context: 'GET /api/files/[id]', fileId, storageKey: fileEntry.storageKey });

      // Check if we should use presigned URL redirect or proxy through API
      // For HTTP endpoints (e.g., local MinIO), we must proxy to avoid mixed content issues
      const s3Endpoint = process.env.S3_ENDPOINT || '';
      const isHttpEndpoint = s3Endpoint.startsWith('http://');
      const LARGE_FILE_THRESHOLD = 5 * 1024 * 1024; // 5MB

      // Try to use presigned URL redirect for large files
      if (fileEntry.size > LARGE_FILE_THRESHOLD && !isHttpEndpoint) {
        logger.debug('File size exceeds threshold, attempting presigned URL redirect', {
          context: 'GET /api/files/[id]',
          fileId,
          fileSize: fileEntry.size,
          threshold: LARGE_FILE_THRESHOLD,
        });

        try {
          const presignedUrl = await fileStorageManager.getFileUrl(fileEntry, { presigned: true });
          logger.debug('Presigned URL generated successfully', {
            context: 'GET /api/files/[id]',
            fileId,
            hasUrl: !!presignedUrl,
          });

          return NextResponse.redirect(presignedUrl);
        } catch (error) {
          logger.debug('Presigned URL generation failed, falling back to proxy download', {
            context: 'GET /api/files/[id]',
            fileId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          // Fall through to proxy download
        }
      }

      // Download file and serve through API
      logger.debug('Downloading file from storage', {
        context: 'GET /api/files/[id]',
        fileId,
        fileSize: fileEntry.size,
      });

      const buffer = await fileStorageManager.downloadFile(fileEntry);

      logger.debug('File downloaded from storage', {
        context: 'GET /api/files/[id]',
        fileId,
        downloadedSize: buffer.length,
      });

      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': fileEntry.mimeType,
          'Content-Length': buffer.length.toString(),
          'Content-Disposition': buildContentDisposition(fileEntry.originalFilename, 'inline'),
          'Cache-Control': 'public, max-age=31536000, immutable',
          // Allow embedding in same-origin iframes (for file preview modal)
          'X-Frame-Options': 'SAMEORIGIN',
          'Content-Security-Policy': "frame-ancestors 'self'",
        },
      });
    } catch (error) {
      logger.error('Error serving file', { context: 'GET /api/files/[id]' }, error instanceof Error ? error : undefined);
      return serverError('Failed to serve file');
    }
  }
);

/**
 * Dissociate a file from all linked entities
 * Updates messages with deletion notes and removes file from character settings
 */
async function dissociateFileFromAll(
  fileId: string,
  file: FileEntry,
  repos: RepositoryContainer
) {
  const timestamp = new Date().toISOString();
  const filename = file.originalFilename || 'unknown file';

  logger.debug('Starting file dissociation', {
    context: 'dissociateFileFromAll',
    fileId,
    filename,
    linkedToCount: file.linkedTo.length,
  });

  // 1. Update messages - add deletion note, remove from attachments
  const chats = await repos.chats.findAll();
  for (const entityId of file.linkedTo) {
    for (const chat of chats) {
      try {
        const messages = await repos.chats.getMessages(chat.id);
        const message = messages.find(m => m.id === entityId && m.type === 'message');
        if (
          message &&
          message.type === 'message' &&
          'attachments' in message &&
          message.attachments?.includes(fileId)
        ) {
          const note = `\n\n[Attachment "${filename}" deleted ${timestamp}]`;
          await repos.chats.updateMessage(chat.id, message.id, {
            content: message.content + note,
            attachments: message.attachments.filter(a => a !== fileId),
          });
          logger.debug('Updated message with deletion note', {
            context: 'dissociateFileFromAll',
            chatId: chat.id,
            messageId: message.id,
            fileId,
          });
          break;
        }
      } catch (error) {
        logger.warn('Error updating message during dissociation', {
          context: 'dissociateFileFromAll',
          chatId: chat.id,
          fileId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // 2. Update characters - clear defaultImageId and avatarOverrides
  try {
    const charsWithDefault = await repos.characters.findByDefaultImageId(fileId);
    for (const char of charsWithDefault) {
      await repos.characters.update(char.id, { defaultImageId: null });
      logger.debug('Cleared character defaultImageId', {
        context: 'dissociateFileFromAll',
        characterId: char.id,
        characterName: char.name,
        fileId,
      });
    }
  } catch (error) {
    logger.warn('Error clearing character defaultImageId', {
      context: 'dissociateFileFromAll',
      fileId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const charsWithOverride = await repos.characters.findByAvatarOverrideImageId(fileId);
    for (const char of charsWithOverride) {
      const filtered = char.avatarOverrides.filter(o => o.imageId !== fileId);
      await repos.characters.update(char.id, { avatarOverrides: filtered });
      logger.debug('Removed from character avatarOverrides', {
        context: 'dissociateFileFromAll',
        characterId: char.id,
        characterName: char.name,
        fileId,
      });
    }
  } catch (error) {
    logger.warn('Error clearing character avatarOverrides', {
      context: 'dissociateFileFromAll',
      fileId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // 3. Clear linkedTo on file
  try {
    await repos.files.update(fileId, { linkedTo: [] });
  } catch (error) {
    logger.warn('Error clearing file linkedTo', {
      context: 'dissociateFileFromAll',
      fileId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.info('File dissociation complete', {
    context: 'dissociateFileFromAll',
    fileId,
    filename,
  });
}

/**
 * DELETE /api/files/:id
 * Delete a file by its ID from S3 storage
 * Use ?force=true to delete even if file is linked to entities
 * Use ?dissociate=true to automatically dissociate from all entities before deletion
 */
export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (request, { user, repos }, { id: fileId }) => {
    try {
      // Check for force and dissociate parameters
      const { searchParams } = new URL(request.url);
      const force = searchParams.get('force') === 'true';
      const dissociate = searchParams.get('dissociate') === 'true';

      // Get file metadata from repository
      const fileEntry = await repos.files.findById(fileId);
      if (!fileEntry) {
        logger.debug('File not found', { context: 'DELETE /api/files/[id]', fileId });
        return notFound('File');
      }

      logger.debug('Deleting file', { context: 'DELETE /api/files/[id]', fileId, hasStorageKey: !!fileEntry.storageKey, force, dissociate });

      // Handle dissociation if requested
      if (dissociate && fileEntry.linkedTo.length > 0) {
        logger.debug('Dissociating file from all linked entities', {
          context: 'DELETE /api/files/[id]',
          fileId,
          linkedToCount: fileEntry.linkedTo.length,
        });

        await dissociateFileFromAll(fileId, fileEntry, repos);
        // Refresh file entry after dissociation
        const updatedFile = await repos.files.findById(fileId);
        if (updatedFile) {
          Object.assign(fileEntry, updatedFile);
        }
      }

      // Check if file is still linked to any entities (unless force=true or dissociate=true)
      if (!force && !dissociate && fileEntry.linkedTo.length > 0) {
        logger.debug('Checking file associations before deletion', {
          context: 'DELETE /api/files/[id]',
          fileId,
          linkedToCount: fileEntry.linkedTo.length,
        });

        // Get enhanced association details for error response
        const userRepos = getUserRepositories(user.id);
        const associations = await getFileAssociations(fileId, fileEntry.linkedTo, userRepos);

        // Only block if there are actual associations found
        // (linkedTo might contain stale entries that don't match real data)
        const hasRealAssociations = associations.characters.length > 0 || associations.messages.length > 0;

        if (hasRealAssociations) {
          logger.debug('File has real associations, blocking deletion', {
            context: 'DELETE /api/files/[id]',
            fileId,
            characterCount: associations.characters.length,
            messageCount: associations.messages.length,
          });

          return badRequest(
            'File is linked to other items',
            {
              code: 'FILE_HAS_ASSOCIATIONS',
              associations,
            }
          );
        } else {
          // linkedTo has stale entries but no real associations found
          // Clean up the stale linkedTo and proceed with deletion
          logger.info('File has stale linkedTo entries, cleaning up before deletion', {
            context: 'DELETE /api/files/[id]',
            fileId,
            staleLinkedToCount: fileEntry.linkedTo.length,
          });
          await repos.files.update(fileId, { linkedTo: [] });
        }
      }

      // Delete from storage if file has storageKey
      if (fileEntry.storageKey) {
        logger.debug('Deleting file from storage', {
          context: 'DELETE /api/files/[id]',
          fileId,
          storageKey: fileEntry.storageKey,
        });

        try {
          await fileStorageManager.deleteFile(fileEntry);
          logger.debug('File deleted from storage', {
            context: 'DELETE /api/files/[id]',
            fileId,
            storageKey: fileEntry.storageKey,
          });
        } catch (storageError) {
          logger.warn('Failed to delete file from storage', {
            context: 'DELETE /api/files/[id]',
            fileId,
            storageKey: fileEntry.storageKey,
            error: storageError instanceof Error ? storageError.message : 'Unknown error',
          });
          // Continue with metadata deletion even if storage deletion fails
        }
      }

      // Delete the file metadata from repository
      logger.debug('Deleting file metadata from repository', {
        context: 'DELETE /api/files/[id]',
        fileId,
      });

      const deleted = await repos.files.delete(fileId);

      if (!deleted) {
        logger.warn('File metadata not found when attempting deletion', {
          context: 'DELETE /api/files/[id]',
          fileId,
        });

        return notFound('File');
      }

      logger.info('File deleted successfully', {
        context: 'DELETE /api/files/[id]',
        fileId,
        hadStorageKey: !!fileEntry.storageKey,
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error('Error deleting file', { context: 'DELETE /api/files/[id]' }, error instanceof Error ? error : undefined);
      return serverError('Failed to delete file');
    }
  }
);

/**
 * PATCH /api/files/:id/unlink
 * Remove a link from a file
 */
export const PATCH = createAuthenticatedParamsHandler<{ id: string }>(
  async (request, { user, repos }, { id: fileId }) => {
    try {
      const { entityId } = await request.json();

      if (!entityId) {
        return badRequest('entityId is required');
      }

      // Get file metadata from repository (supports MongoDB and JSON backends)
      const fileEntry = await repos.files.findById(fileId);
      if (!fileEntry) {
        return notFound('File');
      }

      // Security: verify file belongs to user
      if (fileEntry.userId !== user.id) {
        return forbidden();
      }

      // Remove the link using repository
      const updated = await repos.files.removeLink(fileId, entityId);
      if (!updated) {
        return serverError('Failed to update file');
      }

      // If no more links, consider auto-deleting the file
      if (updated.linkedTo.length === 0) {
        // Optionally delete the file automatically
        // await deleteFile(fileId);
        // return NextResponse.json({ success: true, deleted: true });
      }

      return NextResponse.json({ success: true, file: updated });
    } catch (error) {
      logger.error('Error unlinking file', { context: 'PATCH /api/files/[id]' }, error instanceof Error ? error : undefined);
      return serverError('Failed to unlink file');
    }
  }
);
