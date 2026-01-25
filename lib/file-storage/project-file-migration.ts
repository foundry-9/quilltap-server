/**
 * Project File Migration Service
 *
 * Handles migrating files from one mount point to another when a project's
 * mount point assignment changes. Uses batch processing with progress tracking
 * and error handling.
 *
 * @module file-storage/project-file-migration
 */

import { fileStorageManager } from './manager';
import { getRepositories } from '@/lib/repositories/factory';
import { createLogger } from '@/lib/logging/create-logger';
import type { FileEntry } from '@/lib/schemas/file.types';

const logger = createLogger('file-storage:project-migration');

// ============================================================================
// TYPES
// ============================================================================

/**
 * Progress information for file migration
 */
export interface MigrationProgress {
  /** Total number of files to migrate */
  total: number;
  /** Number of files successfully migrated */
  completed: number;
  /** Number of files that failed to migrate */
  failed: number;
  /** Current status */
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  /** Error messages for failed files */
  errors: MigrationError[];
  /** Progress percentage (0-100) */
  percentage: number;
}

/**
 * Error information for a failed file migration
 */
export interface MigrationError {
  fileId: string;
  filename: string;
  error: string;
}

/**
 * Result of the migration operation
 */
export interface MigrationResult {
  success: boolean;
  total: number;
  migrated: number;
  failed: number;
  errors: MigrationError[];
  durationMs: number;
}

/**
 * Options for migration
 */
export interface MigrationOptions {
  /** Batch size for processing (default: 50) */
  batchSize?: number;
  /** Callback for progress updates */
  onProgress?: (progress: MigrationProgress) => void;
}

// ============================================================================
// MIGRATION SERVICE
// ============================================================================

const BATCH_SIZE = 50;

/**
 * Migrate all files in a project from one mount point to another
 *
 * @param projectId - The project ID
 * @param fromMountPointId - The source mount point ID (null to migrate from whatever mount point files are currently on)
 * @param toMountPointId - The target mount point ID
 * @param options - Migration options
 * @returns Migration result with success status and counts
 */
export async function migrateProjectFiles(
  projectId: string,
  fromMountPointId: string | null,
  toMountPointId: string,
  options: MigrationOptions = {}
): Promise<MigrationResult> {
  const startTime = Date.now();
  const batchSize = options.batchSize || BATCH_SIZE;
  const repos = getRepositories();

  logger.info('Starting project file migration', {
    projectId,
    fromMountPointId,
    toMountPointId,
    batchSize,
  });

  // Get project to find owner
  const project = await repos.projects.findById(projectId);
  if (!project) {
    logger.error('Project not found', { projectId });
    return {
      success: false,
      total: 0,
      migrated: 0,
      failed: 0,
      errors: [{ fileId: '', filename: '', error: `Project ${projectId} not found` }],
      durationMs: Date.now() - startTime,
    };
  }

  // Validate target mount point
  const targetMountPoint = fileStorageManager.getMountPoint(toMountPointId);
  if (!targetMountPoint) {
    logger.error('Target mount point not found', { toMountPointId });
    return {
      success: false,
      total: 0,
      migrated: 0,
      failed: 0,
      errors: [{ fileId: '', filename: '', error: `Target mount point ${toMountPointId} not found` }],
      durationMs: Date.now() - startTime,
    };
  }

  if (targetMountPoint.healthStatus === 'unhealthy') {
    logger.error('Target mount point is unhealthy', { toMountPointId, healthStatus: targetMountPoint.healthStatus });
    return {
      success: false,
      total: 0,
      migrated: 0,
      failed: 0,
      errors: [{ fileId: '', filename: '', error: `Target mount point is unhealthy` }],
      durationMs: Date.now() - startTime,
    };
  }

  // Get all files in the project
  const allFiles = await repos.files.findByProjectId(project.userId, projectId);

  // Filter to files that need migration (on a different mount point)
  const filesToMigrate = allFiles.filter((file) => {
    if (!file.mountPointId) return true; // Files without mount point need migration
    if (fromMountPointId && file.mountPointId !== fromMountPointId) return false;
    return file.mountPointId !== toMountPointId;
  });

  logger.info('Found files to migrate', {
    projectId,
    totalFiles: allFiles.length,
    filesToMigrate: filesToMigrate.length,
  });

  if (filesToMigrate.length === 0) {
    return {
      success: true,
      total: 0,
      migrated: 0,
      failed: 0,
      errors: [],
      durationMs: Date.now() - startTime,
    };
  }

  // Initialize progress
  const progress: MigrationProgress = {
    total: filesToMigrate.length,
    completed: 0,
    failed: 0,
    status: 'in_progress',
    errors: [],
    percentage: 0,
  };

  if (options.onProgress) {
    options.onProgress({ ...progress });
  }

  // Process files in batches
  for (let i = 0; i < filesToMigrate.length; i += batchSize) {
    const batch = filesToMigrate.slice(i, i + batchSize);
    for (const file of batch) {
      try {
        await migrateFile(file, toMountPointId, repos);
        progress.completed++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Failed to migrate file', {
          fileId: file.id,
          filename: file.originalFilename,
          error: errorMessage,
        });
        progress.failed++;
        progress.errors.push({
          fileId: file.id,
          filename: file.originalFilename,
          error: errorMessage,
        });
      }

      // Update progress
      progress.percentage = Math.round(((progress.completed + progress.failed) / progress.total) * 100);
      if (options.onProgress) {
        options.onProgress({ ...progress });
      }
    }
  }

  // Final status
  progress.status = progress.failed === 0 ? 'completed' : (progress.completed > 0 ? 'completed' : 'failed');

  if (options.onProgress) {
    options.onProgress({ ...progress });
  }

  const result: MigrationResult = {
    success: progress.failed === 0,
    total: progress.total,
    migrated: progress.completed,
    failed: progress.failed,
    errors: progress.errors,
    durationMs: Date.now() - startTime,
  };

  logger.info('Project file migration completed', {
    projectId,
    ...result,
  });

  return result;
}

/**
 * Migrate a single file to a new mount point
 *
 * @param file - The file entry to migrate
 * @param toMountPointId - The target mount point ID
 * @param repos - Repository container
 */
async function migrateFile(
  file: FileEntry,
  toMountPointId: string,
  repos: ReturnType<typeof getRepositories>
): Promise<void> {
  if (!file.storageKey) {
    throw new Error('File has no storage key');
  }

  // Get source backend
  const sourceBackend = await fileStorageManager.getBackendForFile(file);

  // Get target backend
  const targetBackend = await fileStorageManager.getBackend(toMountPointId);
  if (!targetBackend) {
    throw new Error(`Target backend not found for mount point ${toMountPointId}`);
  }

  // Download file from source
  const content = await sourceBackend.download(file.storageKey);

  // Generate new storage key for target (use same key structure)
  const newStorageKey = file.storageKey;

  // Upload to target
  await targetBackend.upload(newStorageKey, content, file.mimeType);

  // Update file record
  await repos.files.update(file.id, {
    mountPointId: toMountPointId,
    storageKey: newStorageKey,
  });

  // Delete from source (only after successful upload and DB update)
  try {
    await sourceBackend.delete(file.storageKey);
  } catch (deleteError) {
    // Log but don't fail - file is safely on target
    logger.warn('Failed to delete file from source mount point', {
      fileId: file.id,
      fromMountPointId: file.mountPointId,
      error: deleteError instanceof Error ? deleteError.message : String(deleteError),
    });
  }
}

/**
 * Get count of files that would need to be migrated
 *
 * @param projectId - The project ID
 * @param toMountPointId - The target mount point ID
 * @returns Number of files that would need migration
 */
export async function getFileMigrationCount(
  projectId: string,
  toMountPointId: string
): Promise<number> {
  const repos = getRepositories();

  // Get project to find owner
  const project = await repos.projects.findById(projectId);
  if (!project) {
    return 0;
  }

  const allFiles = await repos.files.findByProjectId(project.userId, projectId);

  return allFiles.filter((file) => {
    if (!file.mountPointId) return true;
    return file.mountPointId !== toMountPointId;
  }).length;
}
