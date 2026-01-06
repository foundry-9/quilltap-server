/**
 * Folder Operations API Route
 *
 * POST /api/files/folders - Create a folder (validates and normalizes path)
 * PATCH /api/files/folders - Rename a folder (updates all files in folder)
 * DELETE /api/files/folders - Delete an empty folder
 *
 * Note: Folders are implicit in this system - they exist when files reference them.
 * These operations help manage the folder structure by updating file paths.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { badRequest, serverError, notFound } from '@/lib/api/responses';
import {
  validateFolderPath,
  normalizeFolderPath,
  getParentPath,
  getFolderName,
} from '@/lib/files/folder-utils';

interface CreateFolderRequest {
  path: string;
  projectId?: string | null;
}

interface RenameFolderRequest {
  path: string;
  newName: string;
  projectId?: string | null;
}

interface DeleteFolderRequest {
  path: string;
  projectId?: string | null;
}

/**
 * Validate folder name for renaming
 */
function validateFolderName(name: string): { isValid: boolean; error?: string; sanitized?: string } {
  if (!name || typeof name !== 'string') {
    return { isValid: false, error: 'Folder name must be a non-empty string' };
  }

  const trimmed = name.trim();

  if (trimmed.length === 0) {
    return { isValid: false, error: 'Folder name cannot be empty' };
  }

  if (trimmed.length > 100) {
    return { isValid: false, error: 'Folder name must be 100 characters or less' };
  }

  // Check for invalid characters (same as file path validation)
  const invalidChars = /[<>:"|?*\x00-\x1f/\\]/;
  if (invalidChars.test(trimmed)) {
    return { isValid: false, error: 'Folder name contains invalid characters' };
  }

  // Check for path traversal
  if (trimmed === '.' || trimmed === '..') {
    return { isValid: false, error: 'Invalid folder name' };
  }

  return { isValid: true, sanitized: trimmed };
}

/**
 * POST /api/files/folders
 * Create a folder (validates path, returns success if valid)
 *
 * Since folders are implicit, this mainly validates the path and
 * could store it in a user preferences if needed.
 */
export const POST = createAuthenticatedHandler(
  async (request: NextRequest, { user, repos }) => {
    const context = 'POST /api/files/folders';

    try {
      const body: CreateFolderRequest = await request.json();
      const { path, projectId } = body;

      if (!path) {
        return badRequest('path is required');
      }

      // Validate the path
      const validation = validateFolderPath(path);
      if (!validation.isValid) {
        return badRequest(validation.error || 'Invalid folder path');
      }

      const normalizedPath = normalizeFolderPath(path);

      logger.debug('Create folder request', {
        context,
        path: normalizedPath,
        projectId,
        userId: user.id,
      });

      // Check if folder already has files (already exists implicitly)
      const existingFiles = projectId
        ? await repos.files.findByProjectId(user.id, projectId)
        : await repos.files.findGeneralFiles(user.id);

      const folderExists = existingFiles.some(
        (f) => (f.folderPath || '/').startsWith(normalizedPath)
      );

      logger.info('Folder validated', {
        context,
        path: normalizedPath,
        alreadyHasFiles: folderExists,
        projectId,
      });

      return NextResponse.json({
        success: true,
        path: normalizedPath,
        alreadyExists: folderExists,
        message: folderExists
          ? 'Folder already contains files'
          : 'Folder path is valid and ready for use',
      });
    } catch (error) {
      logger.error('Error creating folder', { context }, error instanceof Error ? error : undefined);
      return serverError('Failed to create folder');
    }
  }
);

/**
 * PATCH /api/files/folders
 * Rename a folder (updates folderPath for all files in the folder)
 */
export const PATCH = createAuthenticatedHandler(
  async (request: NextRequest, { user, repos }) => {
    const context = 'PATCH /api/files/folders';

    try {
      const body: RenameFolderRequest = await request.json();
      const { path, newName, projectId } = body;

      if (!path) {
        return badRequest('path is required');
      }

      if (!newName) {
        return badRequest('newName is required');
      }

      // Validate the current path
      const pathValidation = validateFolderPath(path);
      if (!pathValidation.isValid) {
        return badRequest(pathValidation.error || 'Invalid folder path');
      }

      // Validate the new name
      const nameValidation = validateFolderName(newName);
      if (!nameValidation.isValid) {
        return badRequest(nameValidation.error || 'Invalid folder name');
      }

      const normalizedPath = normalizeFolderPath(path);

      // Can't rename root
      if (normalizedPath === '/') {
        return badRequest('Cannot rename root folder');
      }

      const sanitizedName = nameValidation.sanitized!;
      const parentPath = getParentPath(normalizedPath);
      const newPath = normalizeFolderPath(`${parentPath}${sanitizedName}`);

      // Validate the new full path
      const newPathValidation = validateFolderPath(newPath);
      if (!newPathValidation.isValid) {
        return badRequest(newPathValidation.error || 'Invalid resulting path');
      }

      logger.debug('Rename folder request', {
        context,
        oldPath: normalizedPath,
        newPath,
        newName: sanitizedName,
        projectId,
        userId: user.id,
      });

      // Find all files in this folder or subfolders
      const allFiles = projectId
        ? await repos.files.findByProjectId(user.id, projectId)
        : await repos.files.findGeneralFiles(user.id);

      const affectedFiles = allFiles.filter((f) => {
        const filePath = f.folderPath || '/';
        return filePath === normalizedPath || filePath.startsWith(normalizedPath);
      });

      if (affectedFiles.length === 0) {
        logger.debug('No files in folder to rename', { context, path: normalizedPath });
        return notFound('Folder');
      }

      // Update each affected file
      let updatedCount = 0;
      for (const file of affectedFiles) {
        const oldFilePath = file.folderPath || '/';
        // Replace the old folder prefix with the new one
        const newFilePath = oldFilePath.replace(normalizedPath, newPath);

        await repos.files.update(file.id, { folderPath: newFilePath });
        updatedCount++;
      }

      logger.info('Folder renamed successfully', {
        context,
        oldPath: normalizedPath,
        newPath,
        filesUpdated: updatedCount,
      });

      return NextResponse.json({
        success: true,
        oldPath: normalizedPath,
        newPath,
        filesUpdated: updatedCount,
      });
    } catch (error) {
      logger.error('Error renaming folder', { context }, error instanceof Error ? error : undefined);
      return serverError('Failed to rename folder');
    }
  }
);

/**
 * DELETE /api/files/folders
 * Delete an empty folder (checks that no files exist in folder)
 */
export const DELETE = createAuthenticatedHandler(
  async (request: NextRequest, { user, repos }) => {
    const context = 'DELETE /api/files/folders';

    try {
      // Get params from URL since DELETE doesn't have a body in standard REST
      const url = new URL(request.url);
      const path = url.searchParams.get('path');
      const projectId = url.searchParams.get('projectId');

      if (!path) {
        return badRequest('path is required');
      }

      const validation = validateFolderPath(path);
      if (!validation.isValid) {
        return badRequest(validation.error || 'Invalid folder path');
      }

      const normalizedPath = normalizeFolderPath(path);

      // Can't delete root
      if (normalizedPath === '/') {
        return badRequest('Cannot delete root folder');
      }

      logger.debug('Delete folder request', {
        context,
        path: normalizedPath,
        projectId,
        userId: user.id,
      });

      // Check if any files exist in this folder or subfolders
      const allFiles = projectId
        ? await repos.files.findByProjectId(user.id, projectId)
        : await repos.files.findGeneralFiles(user.id);

      const filesInFolder = allFiles.filter((f) => {
        const filePath = f.folderPath || '/';
        return filePath === normalizedPath || filePath.startsWith(normalizedPath);
      });

      if (filesInFolder.length > 0) {
        logger.debug('Cannot delete non-empty folder', {
          context,
          path: normalizedPath,
          fileCount: filesInFolder.length,
        });
        return badRequest(`Folder contains ${filesInFolder.length} file(s) and cannot be deleted`);
      }

      // Folder is empty - since folders are implicit, we just confirm it's empty
      logger.info('Empty folder confirmed', {
        context,
        path: normalizedPath,
      });

      return NextResponse.json({
        success: true,
        message: 'Folder is empty and can be considered deleted',
        path: normalizedPath,
      });
    } catch (error) {
      logger.error('Error deleting folder', { context }, error instanceof Error ? error : undefined);
      return serverError('Failed to delete folder');
    }
  }
);
