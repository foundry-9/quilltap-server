/**
 * File Move/Rename API Route
 *
 * PATCH /api/files/:id/move - Move file to new folder, project, and/or rename
 * Body: { folderPath?: string, filename?: string, projectId?: string | null }
 */

import { NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { notFound, badRequest, serverError, forbidden } from '@/lib/api/responses';
import { validateFolderPath, normalizeFolderPath } from '@/lib/files/folder-utils';
import { fileStorageManager } from '@/lib/file-storage/manager';

interface MoveRequest {
  folderPath?: string;
  filename?: string;
  /** Project ID to move the file to, or null to move to general files */
  projectId?: string | null;
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
      const { folderPath, filename, projectId } = body;

      // Require at least one field to change
      if (folderPath === undefined && filename === undefined && projectId === undefined) {
        return badRequest('At least one of folderPath, filename, or projectId must be provided');
      }

      logger.debug('Move/rename file request', {
        context,
        fileId,
        folderPath,
        filename,
        projectId,
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
      const updates: Record<string, string | null> = {};

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

      // Handle projectId change (can be a string ID or null for general files)
      if (projectId !== undefined) {
        updates.projectId = projectId;
      }

      // Check if anything actually changed
      const folderChanged = updates.folderPath !== undefined && updates.folderPath !== fileEntry.folderPath;
      const filenameChanged = updates.originalFilename !== undefined && updates.originalFilename !== fileEntry.originalFilename;
      const projectChanged = updates.projectId !== undefined && updates.projectId !== fileEntry.projectId;

      const noChange = !folderChanged && !filenameChanged && !projectChanged;

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
        folderChanged,
        filenameChanged,
        projectChanged,
        originalFolderPath: fileEntry.folderPath,
        originalFilename: fileEntry.originalFilename,
        originalProjectId: fileEntry.projectId,
      });

      // Update the file metadata first
      const updatedFile = await repos.files.update(fileId, updates);

      if (!updatedFile) {
        logger.error('Failed to update file', { context, fileId });
        return serverError('Failed to update file');
      }

      // If folder or project changed, move the storage object
      const oldStorageKey = fileEntry.storageKey;
      if (oldStorageKey && (folderChanged || projectChanged)) {
        const newStorageKey = fileStorageManager.buildStorageKey({
          userId: user.id,
          fileId,
          filename: updatedFile.originalFilename,
          projectId: updatedFile.projectId ?? null,
          folderPath: updatedFile.folderPath ?? '/',
        });

        if (newStorageKey !== oldStorageKey) {
          logger.debug('Moving storage object', {
            context,
            fileId,
            oldStorageKey,
            newStorageKey,
          });

          try {
            const backend = fileStorageManager.getBackendForFile(fileEntry);

            // Try to use backend copy if available, otherwise download and re-upload
            if (backend.copy) {
              await backend.copy(oldStorageKey, newStorageKey);
              logger.debug('Storage object copied via backend', {
                context,
                fileId,
                oldStorageKey,
                newStorageKey,
              });
            } else {
              // Download from old location and upload to new location
              const content = await fileStorageManager.downloadFile(fileEntry);
              await fileStorageManager.uploadFile({
                userId: user.id,
                fileId,
                filename: updatedFile.originalFilename,
                content,
                contentType: fileEntry.mimeType,
                projectId: updatedFile.projectId ?? null,
                folderPath: updatedFile.folderPath || '/',
              });
              logger.debug('Storage object moved via download-upload', {
                context,
                fileId,
                oldStorageKey,
                newStorageKey,
              });
            }

            // Delete the old file from storage
            try {
              await backend.delete(oldStorageKey);
              logger.debug('Old storage object deleted', {
                context,
                fileId,
                oldStorageKey,
              });
            } catch (deleteError) {
              logger.warn('Failed to delete old storage object', {
                context,
                fileId,
                oldStorageKey,
                error: deleteError instanceof Error ? deleteError.message : 'Unknown error',
              });
            }

            // Update the storageKey in the database
            await repos.files.update(fileId, { storageKey: newStorageKey });

            logger.info('Storage object moved successfully', {
              context,
              fileId,
              oldStorageKey,
              newStorageKey,
            });
          } catch (storageError) {
            // Log the error but don't fail the request - metadata is already updated
            logger.error(
              'Failed to move storage object, metadata updated but storage key unchanged',
              { context, fileId, oldStorageKey, newStorageKey },
              storageError instanceof Error ? storageError : undefined
            );
            // Revert the metadata update to keep consistency
            await repos.files.update(fileId, {
              folderPath: fileEntry.folderPath,
              projectId: fileEntry.projectId,
            });
            return serverError('Failed to move file in storage');
          }
        }
      }

      // Re-fetch to get the updated storageKey
      const finalFile = await repos.files.findById(fileId);

      logger.info('File moved/renamed successfully', {
        context,
        fileId,
        newFolderPath: finalFile?.folderPath,
        newFilename: finalFile?.originalFilename,
        newProjectId: finalFile?.projectId,
        newStorageKey: finalFile?.storageKey,
      });

      return NextResponse.json({
        success: true,
        file: finalFile || updatedFile,
      });
    } catch (error) {
      logger.error('Error moving/renaming file', { context, fileId }, error instanceof Error ? error : undefined);
      return serverError('Failed to move/rename file');
    }
  }
);
