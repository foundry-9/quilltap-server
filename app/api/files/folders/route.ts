/**
 * Folder Operations API Route
 *
 * GET /api/files/folders - List all folders for a user/project
 * POST /api/files/folders - Create a folder entity
 * PATCH /api/files/folders - Rename a folder
 * DELETE /api/files/folders - Delete an empty folder
 *
 * Folders are first-class entities stored in the database.
 * For local backends, actual directories are created/deleted.
 * For S3 backends, folders exist only in DB (S3 uses key prefixes).
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
import { fileStorageManager } from '@/lib/file-storage/manager';

interface CreateFolderRequest {
  path: string;
  projectId?: string | null;
}

interface RenameFolderRequest {
  path: string;
  newName: string;
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
 * Recursively ensure parent folders exist, creating them if needed
 * Returns the ID of the immediate parent folder (or null if root)
 */
async function ensureParentFoldersExist(
  repos: any,
  userId: string,
  path: string,
  projectId: string | null
): Promise<string | null> {
  // Root folder has no parent
  if (path === '/') {
    return null;
  }

  const parentPath = getParentPath(path);

  // If parent is root, no parent folder entity needed
  if (parentPath === '/') {
    return null;
  }

  // Check if parent folder exists
  let parentFolder = await repos.folders.findByPath(userId, parentPath, projectId);

  if (!parentFolder) {
    // Recursively ensure grandparent exists
    const grandparentId = await ensureParentFoldersExist(repos, userId, parentPath, projectId);

    // Create parent folder
    const parentName = getFolderName(parentPath) || 'Folder';
    parentFolder = await repos.folders.create({
      userId,
      path: parentPath,
      name: parentName,
      parentFolderId: grandparentId,
      projectId: projectId || null,
      mountPointId: null,
    });

    logger.debug('Created parent folder', {
      path: parentPath,
      folderId: parentFolder.id,
    });

    // Create storage directory for local backends
    try {
      await fileStorageManager.createFolder({
        userId,
        projectId,
        folderPath: parentPath,
      });
    } catch (error) {
      logger.warn('Failed to create parent folder in storage', {
        path: parentPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return parentFolder.id;
}

/**
 * GET /api/files/folders
 * List all folders for a user/project
 */
export const GET = createAuthenticatedHandler(
  async (request: NextRequest, { user, repos }) => {
    const context = 'GET /api/files/folders';

    try {
      const url = new URL(request.url);
      const projectId = url.searchParams.get('projectId');

      logger.debug('List folders request', {
        context,
        projectId,
        userId: user.id,
      });

      const folders = await repos.folders.findAllInProject(
        user.id,
        projectId || null
      );

      logger.debug('Retrieved folders', {
        context,
        count: folders.length,
        projectId,
      });

      return NextResponse.json({
        folders,
        count: folders.length,
      });
    } catch (error) {
      logger.error('Error listing folders', { context }, error instanceof Error ? error : undefined);
      return serverError('Failed to list folders');
    }
  }
);

/**
 * POST /api/files/folders
 * Create a folder entity
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

      // Check if folder already exists
      const existingFolder = await repos.folders.findByPath(
        user.id,
        normalizedPath,
        projectId || null
      );

      if (existingFolder) {
        logger.debug('Folder already exists', {
          context,
          path: normalizedPath,
          folderId: existingFolder.id,
        });

        return NextResponse.json({
          success: true,
          folder: existingFolder,
          alreadyExists: true,
          message: 'Folder already exists',
        });
      }

      // Ensure parent folders exist (creates them recursively if needed)
      const parentFolderId = await ensureParentFoldersExist(
        repos,
        user.id,
        normalizedPath,
        projectId || null
      );

      // Create the folder entity
      const folderName = getFolderName(normalizedPath) || 'Folder';
      const folder = await repos.folders.create({
        userId: user.id,
        path: normalizedPath,
        name: folderName,
        parentFolderId,
        projectId: projectId || null,
        mountPointId: null,
      });

      logger.debug('Created folder entity', {
        context,
        path: normalizedPath,
        folderId: folder.id,
        parentFolderId,
      });

      // Create storage directory for local backends
      try {
        await fileStorageManager.createFolder({
          userId: user.id,
          projectId: projectId || null,
          folderPath: normalizedPath,
        });
      } catch (error) {
        logger.warn('Failed to create folder in storage (may be S3 backend)', {
          context,
          path: normalizedPath,
          error: error instanceof Error ? error.message : String(error),
        });
        // Don't fail the request - folder entity is created, storage is optional
      }

      logger.info('Folder created', {
        context,
        path: normalizedPath,
        folderId: folder.id,
        projectId,
      });

      return NextResponse.json({
        success: true,
        folder,
        alreadyExists: false,
        message: 'Folder created successfully',
      });
    } catch (error) {
      logger.error('Error creating folder', { context }, error instanceof Error ? error : undefined);
      return serverError('Failed to create folder');
    }
  }
);

/**
 * PATCH /api/files/folders
 * Rename a folder (updates folder entity and all affected file paths)
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

      // Find the folder entity
      const folder = await repos.folders.findByPath(
        user.id,
        normalizedPath,
        projectId || null
      );

      if (!folder) {
        return notFound('Folder');
      }

      // Update the folder entity
      await repos.folders.update(folder.id, {
        path: newPath,
        name: sanitizedName,
      });

      // Update all descendant folders' paths
      const descendantFoldersUpdated = await repos.folders.updatePathPrefix(
        user.id,
        normalizedPath,
        newPath,
        projectId || null
      );

      // Update all affected file paths
      const allFiles = projectId
        ? await repos.files.findByProjectId(user.id, projectId)
        : await repos.files.findGeneralFiles(user.id);

      const affectedFiles = allFiles.filter((f: any) => {
        const filePath = f.folderPath || '/';
        return filePath === normalizedPath || filePath.startsWith(normalizedPath);
      });

      let filesUpdated = 0;
      for (const file of affectedFiles) {
        const oldFilePath = file.folderPath || '/';
        const newFilePath = oldFilePath.replace(normalizedPath, newPath);
        await repos.files.update(file.id, { folderPath: newFilePath });
        filesUpdated++;
      }

      logger.info('Folder renamed successfully', {
        context,
        oldPath: normalizedPath,
        newPath,
        foldersUpdated: descendantFoldersUpdated + 1,
        filesUpdated,
      });

      return NextResponse.json({
        success: true,
        oldPath: normalizedPath,
        newPath,
        foldersUpdated: descendantFoldersUpdated + 1,
        filesUpdated,
      });
    } catch (error) {
      logger.error('Error renaming folder', { context }, error instanceof Error ? error : undefined);
      return serverError('Failed to rename folder');
    }
  }
);

/**
 * DELETE /api/files/folders
 * Delete an empty folder (checks for files and child folders)
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

      // Find the folder entity
      const folder = await repos.folders.findByPath(
        user.id,
        normalizedPath,
        projectId || null
      );

      if (!folder) {
        return notFound('Folder');
      }

      // Check if any files exist in this folder or subfolders
      const allFiles = projectId
        ? await repos.files.findByProjectId(user.id, projectId)
        : await repos.files.findGeneralFiles(user.id);

      const filesInFolder = allFiles.filter((f: any) => {
        const filePath = f.folderPath || '/';
        return filePath === normalizedPath || filePath.startsWith(normalizedPath);
      });

      if (filesInFolder.length > 0) {
        logger.debug('Cannot delete non-empty folder (has files)', {
          context,
          path: normalizedPath,
          fileCount: filesInFolder.length,
        });
        return badRequest(`Folder contains ${filesInFolder.length} file(s) and cannot be deleted`);
      }

      // Check if any child folders exist
      const hasChildren = await repos.folders.hasChildren(folder.id);
      if (hasChildren) {
        logger.debug('Cannot delete folder with child folders', {
          context,
          path: normalizedPath,
        });
        return badRequest('Folder contains subfolders and cannot be deleted');
      }

      // Delete from storage (for local backends)
      try {
        await fileStorageManager.deleteFolder({
          userId: user.id,
          projectId: projectId || null,
          folderPath: normalizedPath,
        });
      } catch (error) {
        logger.warn('Failed to delete folder from storage', {
          context,
          path: normalizedPath,
          error: error instanceof Error ? error.message : String(error),
        });
        // Don't fail the request - folder entity will be deleted
      }

      // Delete the folder entity
      await repos.folders.delete(folder.id);

      logger.info('Folder deleted', {
        context,
        path: normalizedPath,
        folderId: folder.id,
      });

      return NextResponse.json({
        success: true,
        message: 'Folder deleted successfully',
        path: normalizedPath,
      });
    } catch (error) {
      logger.error('Error deleting folder', { context }, error instanceof Error ? error : undefined);
      return serverError('Failed to delete folder');
    }
  }
);
