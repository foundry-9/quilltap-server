/**
 * File Overwrite Utilities
 *
 * Shared helper for detecting and preparing file overwrites when a new file
 * is written with the same name in the same scope (userId + projectId + folderPath).
 * Reuses the existing fileId so references remain valid.
 *
 * @module lib/files/overwrite-utils
 */

import { createLogger } from '@/lib/logging/create-logger';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { canGenerateThumbnail, cleanupThumbnails } from '@/lib/files/thumbnail-utils';
import type { FileEntry } from '@/lib/schemas/file.types';

const logger = createLogger('files:overwrite');

/**
 * Parameters for checking file overwrite scope
 */
export interface OverwriteScopeParams {
  userId: string;
  projectId: string | null;
  folderPath: string;
  filename: string;
}

/**
 * Result when an existing file is found for overwrite
 */
export interface OverwriteResult {
  /** The existing file entry that will be overwritten */
  existingFile: FileEntry;
  /** The file ID to reuse (preserves references) */
  fileId: string;
}

/**
 * Repository interface needed for overwrite detection.
 * Accepts any object with findByFilenameInScope.
 */
export interface OverwriteRepos {
  files: {
    findByFilenameInScope(
      userId: string,
      projectId: string | null,
      folderPath: string,
      filename: string
    ): Promise<FileEntry[]>;
  };
}

/**
 * Check if a file with the same name exists in the same scope and prepare
 * for overwrite by cleaning up the old physical file and thumbnails.
 *
 * @param repos - Repository access (needs files.findByFilenameInScope)
 * @param params - The scope parameters to check
 * @returns OverwriteResult if an existing file was found, null otherwise
 */
export async function findAndPrepareOverwrite(
  repos: OverwriteRepos,
  params: OverwriteScopeParams
): Promise<OverwriteResult | null> {
  const { userId, projectId, folderPath, filename } = params;

  const existing = await repos.files.findByFilenameInScope(
    userId,
    projectId,
    folderPath,
    filename
  );

  if (existing.length === 0) {
    return null;
  }

  // Use the first match (should typically be only one)
  const existingFile = existing[0];

  logger.info('File overwrite detected — reusing existing fileId', {
    fileId: existingFile.id,
    filename,
    folderPath,
    projectId,
  });

  // Clean up old physical file
  try {
    await fileStorageManager.deleteFile(existingFile);
  } catch (error) {
    logger.warn('Failed to delete old physical file during overwrite — continuing', {
      fileId: existingFile.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Clean up thumbnails if applicable
  if (canGenerateThumbnail(existingFile.mimeType)) {
    try {
      await cleanupThumbnails(existingFile);
    } catch (error) {
      logger.warn('Failed to clean up thumbnails during overwrite — continuing', {
        fileId: existingFile.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    existingFile,
    fileId: existingFile.id,
  };
}
