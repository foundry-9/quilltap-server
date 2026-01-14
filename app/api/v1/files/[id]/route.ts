/**
 * Files API v1 - Individual File Endpoint
 *
 * GET /api/v1/files/[id] - Download a file
 * DELETE /api/v1/files/[id] - Delete a file
 * POST /api/v1/files/[id]?action=move - Move file to new folder/project
 * POST /api/v1/files/[id]?action=promote - Promote attachment to general/project files
 * GET /api/v1/files/[id]?action=thumbnail - Get thumbnail for image
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler, checkOwnership } from '@/lib/api/middleware';
import { getActionParam } from '@/lib/api/middleware/actions';
import { getFilePath } from '@/lib/api/middleware/file-path';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { logger } from '@/lib/logger';
import sharp from 'sharp';
import { normalizeFolderPath, validateFolderPath } from '@/lib/files/folder-utils';
import { canResizeImage } from '@/lib/files/image-processing';
import { getFileAssociations } from '@/lib/files/get-file-associations';
import { getUserRepositories } from '@/lib/repositories/factory';
import { z } from 'zod';
import { successResponse, notFound, badRequest, serverError, forbidden, validationError } from '@/lib/api/responses';

const moveFileSchema = z.object({
  folderPath: z.string().optional(),
  filename: z.string().optional(),
  projectId: z.string().uuid().nullable().optional(),
});

const promoteFileSchema = z.object({
  targetProjectId: z.string().uuid().nullable().optional(),
  folderPath: z.string().optional(),
});

const DEFAULT_THUMBNAIL_SIZE = 150;
const MAX_THUMBNAIL_SIZE = 300;
const THUMBNAIL_QUALITY = 80;

// ============================================================================
// GET Handler - Download file or get thumbnail
// ============================================================================

export const GET = createAuthenticatedParamsHandler<{ id: string }>(async (req, { repos }, { id: fileId }) => {
  const action = getActionParam(req);

  // Handle thumbnail action
  if (action === 'thumbnail') {
    return handleGetThumbnail(req, repos, fileId);
  }

  // Default: download file
  return handleDownloadFile(req, repos, fileId);
});

// ============================================================================
// Helper: Download File
// ============================================================================

async function handleDownloadFile(request: NextRequest, repos: any, fileId: string): Promise<NextResponse> {
  try {
    logger.debug('[Files v1] Downloading file', { fileId });

    // Get file metadata from repository
    const fileEntry = await repos.files.findById(fileId);
    if (!fileEntry) {
      logger.debug('[Files v1] File not found', { fileId });
      return notFound('File');
    }

    if (!fileEntry.storageKey) {
      logger.error('[Files v1] File has no storage key - may need migration', { fileId });
      return serverError('File not available - migration required');
    }

    logger.debug('[Files v1] Serving file from storage', { fileId, storageKey: fileEntry.storageKey });

    // Check if we should use presigned URL redirect or proxy through API
    // For HTTP endpoints (e.g., local MinIO), we must proxy to avoid mixed content issues
    const s3Endpoint = process.env.S3_ENDPOINT || '';
    const isHttpEndpoint = s3Endpoint.startsWith('http://');
    const LARGE_FILE_THRESHOLD = 5 * 1024 * 1024; // 5MB

    // Try to use presigned URL redirect for large files
    if (fileEntry.size > LARGE_FILE_THRESHOLD && !isHttpEndpoint) {
      logger.debug('[Files v1] File size exceeds threshold, attempting presigned URL redirect', {
        fileId,
        fileSize: fileEntry.size,
        threshold: LARGE_FILE_THRESHOLD,
      });

      try {
        const presignedUrl = await fileStorageManager.getFileUrl(fileEntry, { presigned: true });
        logger.debug('[Files v1] Presigned URL generated successfully', {
          fileId,
          hasUrl: !!presignedUrl,
        });

        return NextResponse.redirect(presignedUrl);
      } catch (error) {
        logger.debug('[Files v1] Presigned URL generation failed, falling back to proxy download', {
          fileId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // Fall through to proxy download
      }
    }

    // Download file and serve through API
    logger.debug('[Files v1] Downloading file from storage', {
      fileId,
      fileSize: fileEntry.size,
    });

    const buffer = await fileStorageManager.downloadFile(fileEntry);

    logger.debug('[Files v1] File downloaded from storage', {
      fileId,
      downloadedSize: buffer.length,
    });

    function buildContentDisposition(filename: string, disposition: 'inline' | 'attachment' = 'inline'): string {
      // Check if filename contains non-ASCII characters
      const hasNonAscii = /[^\x00-\x7F]/.test(filename);

      if (!hasNonAscii) {
        // Simple ASCII filename
        return `${disposition}; filename="${filename}"`;
      }

      // For non-ASCII filenames, use RFC 5987 encoding
      const asciiFilename = filename.replace(/[^\x00-\x7F]/g, '_');
      const encodedFilename = encodeURIComponent(filename);

      return `${disposition}; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`;
    }

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': fileEntry.mimeType,
        'Content-Length': buffer.length.toString(),
        'Content-Disposition': buildContentDisposition(fileEntry.originalFilename, 'inline'),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Frame-Options': 'SAMEORIGIN',
        'Content-Security-Policy': "frame-ancestors 'self'",
      },
    });
  } catch (error) {
    logger.error('[Files v1] Error serving file', { fileId }, error instanceof Error ? error : undefined);
    return serverError('Failed to serve file');
  }
}

// ============================================================================
// Helper: Get Thumbnail
// ============================================================================

async function handleGetThumbnail(request: NextRequest, repos: any, fileId: string): Promise<NextResponse> {
  try {
    // Parse size parameter
    const url = new URL(request.url);
    const sizeParam = url.searchParams.get('size');
    let size = DEFAULT_THUMBNAIL_SIZE;

    if (sizeParam) {
      const parsedSize = parseInt(sizeParam, 10);
      if (isNaN(parsedSize) || parsedSize < 1) {
        return badRequest('Invalid size parameter');
      }
      size = Math.min(parsedSize, MAX_THUMBNAIL_SIZE);
    }

    logger.debug('[Files v1] Thumbnail request', {
      fileId,
      requestedSize: sizeParam,
      effectiveSize: size,
    });

    // Get file metadata
    const fileEntry = await repos.files.findById(fileId);
    if (!fileEntry) {
      logger.debug('[Files v1] File not found', { fileId });
      return notFound('File');
    }

    // Check if file is an image that can be thumbnailed
    if (!fileEntry.mimeType.startsWith('image/') || !canResizeImage(fileEntry.mimeType)) {
      logger.debug('[Files v1] File is not a resizable image', { fileId, mimeType: fileEntry.mimeType });
      return badRequest('File is not a resizable image');
    }

    // Build thumbnail storage key
    function buildThumbnailStorageKey(userId: string, fId: string, sz: number): string {
      return `users/${userId}/thumbnails/${fId}_${sz}.webp`;
    }

    const thumbnailKey = buildThumbnailStorageKey(fileEntry.userId, fileId, size);

    logger.debug('[Files v1] Checking for cached thumbnail', {
      fileId,
      thumbnailKey,
    });

    // Try to get cached thumbnail from storage
    try {
      const cachedBuffer = await fileStorageManager.downloadFile({
        ...fileEntry,
        storageKey: thumbnailKey,
      });

      logger.debug('[Files v1] Cached thumbnail found', { fileId, size });

      return new NextResponse(new Uint8Array(cachedBuffer), {
        headers: {
          'Content-Type': 'image/webp',
          'Content-Length': cachedBuffer.length.toString(),
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    } catch {
      // Cached thumbnail not found, generate it
      logger.debug('[Files v1] Cached thumbnail not found, generating', { fileId, size });
    }

    // Download original image
    const imageBuffer = await fileStorageManager.downloadFile(fileEntry);

    logger.debug('[Files v1] Downloaded original image for thumbnail', {
      fileId,
      originalSize: imageBuffer.length,
    });

    // Generate thumbnail using sharp
    const thumbnailBuffer = await sharp(imageBuffer)
      .resize(size, size, {
        fit: 'cover',
        position: 'center',
      })
      .webp({ quality: THUMBNAIL_QUALITY })
      .toBuffer();

    logger.debug('[Files v1] Generated thumbnail', {
      fileId,
      size,
      generatedSize: thumbnailBuffer.length,
    });

    // Cache thumbnail to storage (async, don't wait)
    fileStorageManager.uploadFile({
      userId: fileEntry.userId,
      fileId: `${fileId}_thumb_${size}`,
      filename: `${fileId}_${size}.webp`,
      content: thumbnailBuffer,
      contentType: 'image/webp',
      metadata: {
        originalFileId: fileId,
        thumbnailSize: String(size),
      },
    }).then(() => {
      logger.debug('[Files v1] Cached thumbnail to storage', { fileId, thumbnailKey });
    }).catch((cacheError) => {
      logger.warn('[Files v1] Failed to cache thumbnail', {
        fileId,
        error: cacheError instanceof Error ? cacheError.message : 'Unknown error',
      });
    });

    return new NextResponse(new Uint8Array(thumbnailBuffer), {
      headers: {
        'Content-Type': 'image/webp',
        'Content-Length': thumbnailBuffer.length.toString(),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    logger.error('[Files v1] Error generating thumbnail', { fileId }, error instanceof Error ? error : undefined);
    return serverError('Failed to generate thumbnail');
  }
}

// ============================================================================
// DELETE Handler
// ============================================================================

export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(async (req, { user, repos }, { id: fileId }) => {
  try {
    logger.debug('[Files v1] DELETE file', { fileId, userId: user.id });

    // Get file metadata from repository
    const fileEntry = await repos.files.findById(fileId);
    if (!fileEntry) {
      logger.debug('[Files v1] File not found', { fileId });
      return notFound('File');
    }

    // Verify ownership
    if (fileEntry.userId !== user.id) {
      logger.warn('[Files v1] User tried to delete file they do not own', {
        fileId,
        userId: user.id,
        ownerId: fileEntry.userId,
      });
      return forbidden();
    }

    // Check for force and dissociate parameters
    const { searchParams } = new URL(req.url);
    const force = searchParams.get('force') === 'true';
    const dissociate = searchParams.get('dissociate') === 'true';

    logger.debug('[Files v1] Deleting file', {
      fileId,
      hasStorageKey: !!fileEntry.storageKey,
      force,
      dissociate,
    });

    // Handle dissociation if requested
    if (dissociate && fileEntry.linkedTo.length > 0) {
      logger.debug('[Files v1] Dissociating file from all linked entities', {
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
      logger.debug('[Files v1] Checking file associations before deletion', {
        fileId,
        linkedToCount: fileEntry.linkedTo.length,
      });

      // Get enhanced association details for error response
      const userRepos = getUserRepositories(user.id);
      const associations = await getFileAssociations(fileId, fileEntry.linkedTo, userRepos);

      // Only block if there are actual associations found
      const hasRealAssociations = associations.characters.length > 0 || associations.messages.length > 0;

      if (hasRealAssociations) {
        logger.debug('[Files v1] File has real associations, blocking deletion', {
          fileId,
          characterCount: associations.characters.length,
          messageCount: associations.messages.length,
        });

        return badRequest('File is linked to other items', {
          code: 'FILE_HAS_ASSOCIATIONS',
          associations,
        });
      } else {
        // linkedTo has stale entries but no real associations found
        logger.info('[Files v1] File has stale linkedTo entries, cleaning up before deletion', {
          fileId,
          staleLinkedToCount: fileEntry.linkedTo.length,
        });
        await repos.files.update(fileId, { linkedTo: [] });
      }
    }

    // Delete from storage if file has storageKey
    if (fileEntry.storageKey) {
      logger.debug('[Files v1] Deleting file from storage', {
        fileId,
        storageKey: fileEntry.storageKey,
      });

      try {
        await fileStorageManager.deleteFile(fileEntry);
        logger.debug('[Files v1] File deleted from storage', {
          fileId,
          storageKey: fileEntry.storageKey,
        });
      } catch (storageError) {
        logger.warn('[Files v1] Failed to delete file from storage', {
          fileId,
          storageKey: fileEntry.storageKey,
          error: storageError instanceof Error ? storageError.message : 'Unknown error',
        });
        // Continue with metadata deletion even if storage deletion fails
      }
    }

    // Delete the file metadata from repository
    logger.debug('[Files v1] Deleting file metadata from repository', { fileId });

    const deleted = await repos.files.delete(fileId);

    if (!deleted) {
      logger.warn('[Files v1] File metadata not found when attempting deletion', { fileId });
      return notFound('File');
    }

    logger.info('[Files v1] File deleted successfully', {
      fileId,
      hadStorageKey: !!fileEntry.storageKey,
    });

    return successResponse({ success: true });
  } catch (error) {
    logger.error('[Files v1] Error deleting file', { fileId: (req as any).params?.id }, error instanceof Error ? error : undefined);
    return serverError('Failed to delete file');
  }
});

// ============================================================================
// POST Handler - Actions
// ============================================================================

export const POST = createAuthenticatedParamsHandler<{ id: string }>(async (req, { user, repos }, { id: fileId }) => {
  const action = getActionParam(req);

  // Verify ownership first
  const file = await repos.files.findById(fileId);
  if (!file || file.userId !== user.id) {
    return notFound('File');
  }

  switch (action) {
    case 'move': {
      return handleMoveFile(req, user, repos, fileId, file);
    }

    case 'promote': {
      return handlePromoteFile(req, user, repos, fileId, file);
    }

    default:
      return badRequest(`Unknown action: ${action}. Available actions: move, promote`);
  }
});

// ============================================================================
// Helper: Move File
// ============================================================================

async function handleMoveFile(
  req: NextRequest,
  user: any,
  repos: any,
  fileId: string,
  file: any
): Promise<NextResponse> {
  try {
    const body = await req.json();
    const parsed = moveFileSchema.safeParse(body);

    if (!parsed.success) {
      logger.debug('[Files v1] Invalid move request', { errors: parsed.error.errors });
      return badRequest('Invalid request: ' + parsed.error.errors.map((e: any) => e.message).join(', '));
    }

    const { folderPath: rawFolderPath, filename, projectId } = parsed.data;

    // Require at least one field to change
    if (rawFolderPath === undefined && filename === undefined && projectId === undefined) {
      return badRequest('At least one of folderPath, filename, or projectId must be provided');
    }

    const folderPath = rawFolderPath ? normalizeFolderPath(rawFolderPath) : file.folderPath;
    const targetFilename = filename || file.originalFilename;
    const targetProjectId = projectId === undefined ? file.projectId : projectId;

    logger.debug('[Files v1] Move/rename file request', {
      fileId,
      folderPath,
      filename: targetFilename,
      projectId: targetProjectId,
      userId: user.id,
    });

    // Validate folder path
    if (rawFolderPath) {
      const folderValidation = validateFolderPath(folderPath);
      if (!folderValidation.isValid) {
        return badRequest(folderValidation.error || 'Invalid folder path');
      }
    }

    // Validate filename if changing
    if (filename) {
      if (!filename || filename.trim().length === 0) {
        return badRequest('Filename cannot be empty');
      }
      if (filename.length > 255) {
        return badRequest('Filename must be 255 characters or less');
      }
      // Check for invalid characters
      const invalidChars = /[<>:"|?*\x00-\x1f/\\]/;
      if (invalidChars.test(filename)) {
        return badRequest('Filename contains invalid characters');
      }
    }

    // Verify project ownership if changing
    if (projectId !== undefined && projectId !== null) {
      const project = await repos.projects.findById(projectId);
      if (!project || project.userId !== user.id) {
        logger.debug('[Files v1] Target project not found or not owned by user', { projectId });
        return notFound('Project');
      }
    }

    // Update file
    const updated = await repos.files.update(fileId, {
      originalFilename: targetFilename,
      folderPath,
      projectId: targetProjectId,
    });

    logger.info('[Files v1] File moved/renamed successfully', {
      fileId,
      newFilename: targetFilename,
      newFolderPath: folderPath,
    });

    return successResponse({
      data: {
        id: updated.id,
        userId: updated.userId,
        filename: updated.originalFilename,
        filepath: getFilePath(updated),
        mimeType: updated.mimeType,
        size: updated.size,
        category: updated.category,
        projectId: updated.projectId,
        folderPath: updated.folderPath,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Files v1] Error moving file', { fileId }, error instanceof Error ? error : undefined);
    return serverError('Failed to move file');
  }
}

// ============================================================================
// Helper: Promote File
// ============================================================================

async function handlePromoteFile(
  req: NextRequest,
  user: any,
  repos: any,
  fileId: string,
  file: any
): Promise<NextResponse> {
  try {
    const body = await req.json();
    const parsed = promoteFileSchema.safeParse(body);

    if (!parsed.success) {
      logger.debug('[Files v1] Invalid promotion request', { errors: parsed.error.errors });
      return badRequest('Invalid request: ' + parsed.error.errors.map((e: any) => e.message).join(', '));
    }

    const { targetProjectId, folderPath: rawFolderPath } = parsed.data;
    const folderPath = normalizeFolderPath(rawFolderPath || '/');

    logger.debug('[Files v1] Processing file promotion request', {
      fileId,
      targetProjectId,
      folderPath,
      userId: user.id,
    });

    // Validate folder path
    const folderValidation = validateFolderPath(folderPath);
    if (!folderValidation.isValid) {
      return badRequest(folderValidation.error || 'Invalid folder path');
    }

    // Verify project ownership if targetProjectId provided
    if (targetProjectId) {
      const project = await repos.projects.findById(targetProjectId);
      if (!project || project.userId !== user.id) {
        logger.debug('[Files v1] Target project not found or not owned by user', { targetProjectId });
        return notFound('Project');
      }
    }

    // Update the file's project and folder
    const updated = await repos.files.update(fileId, {
      projectId: targetProjectId ?? null,
      folderPath,
    });

    logger.info('[Files v1] File promoted successfully', {
      fileId,
      targetProjectId,
      folderPath,
    });

    return successResponse({
      data: {
        id: updated.id,
        userId: updated.userId,
        filename: updated.originalFilename,
        filepath: getFilePath(updated),
        mimeType: updated.mimeType,
        size: updated.size,
        category: updated.category,
        projectId: updated.projectId,
        folderPath: updated.folderPath,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Files v1] Error promoting file', { fileId }, error instanceof Error ? error : undefined);
    return serverError('Failed to promote file');
  }
}

// ============================================================================
// Helper: Dissociate File
// ============================================================================

async function dissociateFileFromAll(
  fileId: string,
  file: any,
  repos: any
) {
  const timestamp = new Date().toISOString();
  const filename = file.originalFilename || 'unknown file';

  logger.debug('[Files v1] Starting file dissociation', {
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
        const message = messages.find((m: any) => m.id === entityId && m.type === 'message');
        if (
          message &&
          message.type === 'message' &&
          'attachments' in message &&
          message.attachments?.includes(fileId)
        ) {
          const note = `\n\n[Attachment "${filename}" deleted ${timestamp}]`;
          await repos.chats.updateMessage(chat.id, message.id, {
            content: message.content + note,
            attachments: message.attachments.filter((a: string) => a !== fileId),
          });
          logger.debug('[Files v1] Updated message with deletion note', {
            chatId: chat.id,
            messageId: message.id,
            fileId,
          });
          break;
        }
      } catch (error) {
        logger.warn('[Files v1] Error updating message during dissociation', {
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
      logger.debug('[Files v1] Cleared character defaultImageId', {
        characterId: char.id,
        characterName: char.name,
        fileId,
      });
    }
  } catch (error) {
    logger.warn('[Files v1] Error clearing character defaultImageId', {
      fileId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const charsWithOverride = await repos.characters.findByAvatarOverrideImageId(fileId);
    for (const char of charsWithOverride) {
      const filtered = char.avatarOverrides.filter((o: any) => o.imageId !== fileId);
      await repos.characters.update(char.id, { avatarOverrides: filtered });
      logger.debug('[Files v1] Removed from character avatarOverrides', {
        characterId: char.id,
        characterName: char.name,
        fileId,
      });
    }
  } catch (error) {
    logger.warn('[Files v1] Error clearing character avatarOverrides', {
      fileId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // 3. Clear linkedTo on file
  try {
    await repos.files.update(fileId, { linkedTo: [] });
  } catch (error) {
    logger.warn('[Files v1] Error clearing file linkedTo', {
      fileId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.info('[Files v1] File dissociation complete', {
    fileId,
    filename,
  });
}
