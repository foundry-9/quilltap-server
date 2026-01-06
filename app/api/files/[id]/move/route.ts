/**
 * File Move/Rename API Route
 *
 * PATCH /api/files/:id/move - Move file to new folder and/or rename
 * Body: { folderPath?: string, filename?: string }
 */

import { NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { notFound, badRequest, serverError, forbidden } from '@/lib/api/responses';
import { validateFolderPath, normalizeFolderPath } from '@/lib/files/folder-utils';

interface MoveRequest {
  folderPath?: string;
  filename?: string;
}

/**
 * Validate and sanitize a filename
 */
function validateFilename(filename: string): { isValid: boolean; error?: string; sanitized?: string } {
  if (!filename || typeof filename !== 'string') {
    return { isValid: false, error: 'Filename must be a non-empty string' };
  }

  const trimmed = filename.trim();

  if (trimmed.length === 0) {
    return { isValid: false, error: 'Filename cannot be empty' };
  }

  if (trimmed.length > 255) {
    return { isValid: false, error: 'Filename must be 255 characters or less' };
  }

  // Check for invalid characters
  const invalidChars = /[<>:"|?*\x00-\x1f/\\]/;
  if (invalidChars.test(trimmed)) {
    return { isValid: false, error: 'Filename contains invalid characters' };
  }

  // Check for reserved names (Windows compatibility)
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
  if (reserved.test(trimmed)) {
    return { isValid: false, error: 'Filename is a reserved name' };
  }

  // Don't allow hidden files
  if (trimmed.startsWith('.')) {
    return { isValid: false, error: 'Filename cannot start with a dot' };
  }

  return { isValid: true, sanitized: trimmed };
}

/**
 * PATCH /api/files/:id/move
 * Move file to a new folder and/or rename it
 */
export const PATCH = createAuthenticatedParamsHandler<{ id: string }>(
  async (request, { user, repos }, { id: fileId }) => {
    const context = 'PATCH /api/files/[id]/move';

    try {
      // Parse request body
      const body: MoveRequest = await request.json();
      const { folderPath, filename } = body;

      // Require at least one field to change
      if (folderPath === undefined && filename === undefined) {
        return badRequest('At least one of folderPath or filename must be provided');
      }

      logger.debug('Move/rename file request', {
        context,
        fileId,
        folderPath,
        filename,
        userId: user.id,
      });

      // Get file metadata
      const fileEntry = await repos.files.findById(fileId);
      if (!fileEntry) {
        logger.debug('File not found', { context, fileId });
        return notFound('File');
      }

      // Verify ownership
      if (fileEntry.userId !== user.id) {
        logger.warn('Move access denied - not owner', {
          context,
          fileId,
          fileUserId: fileEntry.userId,
          requestUserId: user.id,
        });
        return forbidden();
      }

      // Prepare update object
      const updates: Record<string, string> = {};

      // Validate and normalize folder path if provided
      if (folderPath !== undefined) {
        const folderValidation = validateFolderPath(folderPath);
        if (!folderValidation.isValid) {
          return badRequest(folderValidation.error || 'Invalid folder path');
        }
        updates.folderPath = normalizeFolderPath(folderPath);
      }

      // Validate filename if provided
      if (filename !== undefined) {
        const filenameValidation = validateFilename(filename);
        if (!filenameValidation.isValid) {
          return badRequest(filenameValidation.error || 'Invalid filename');
        }
        updates.originalFilename = filenameValidation.sanitized!;
      }

      // Check if anything actually changed
      const noChange =
        (updates.folderPath === undefined || updates.folderPath === fileEntry.folderPath) &&
        (updates.originalFilename === undefined || updates.originalFilename === fileEntry.originalFilename);

      if (noChange) {
        logger.debug('No changes to apply', { context, fileId });
        return NextResponse.json({
          success: true,
          message: 'No changes',
          file: fileEntry,
        });
      }

      logger.debug('Applying file updates', {
        context,
        fileId,
        updates,
        originalFolderPath: fileEntry.folderPath,
        originalFilename: fileEntry.originalFilename,
      });

      // Update the file
      const updatedFile = await repos.files.update(fileId, updates);

      if (!updatedFile) {
        logger.error('Failed to update file', { context, fileId });
        return serverError('Failed to update file');
      }

      logger.info('File moved/renamed successfully', {
        context,
        fileId,
        newFolderPath: updatedFile.folderPath,
        newFilename: updatedFile.originalFilename,
      });

      return NextResponse.json({
        success: true,
        file: updatedFile,
      });
    } catch (error) {
      logger.error('Error moving/renaming file', { context, fileId }, error instanceof Error ? error : undefined);
      return serverError('Failed to move/rename file');
    }
  }
);
