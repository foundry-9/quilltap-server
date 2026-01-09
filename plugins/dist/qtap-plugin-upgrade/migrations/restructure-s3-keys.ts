/**
 * Migration: Restructure S3 Keys
 *
 * Restructures S3 keys from category-based paths to project/folder-based paths.
 *
 * Old format: users/{userId}/{CATEGORY}/{fileId}_{filename}
 * New format for project files: users/{userId}/{projectId}/{folderPath}/{fileId}_{filename}
 * New format for general files: users/{userId}/_general/{fileId}_{filename}
 *
 * Dependencies:
 * - migrate-files-to-s3-v1: Must run after initial S3 migration
 *
 * This migration:
 * 1. Finds all file entries that have old-format S3 keys
 * 2. For each file:
 *    - Builds the new S3 key based on projectId and folderPath
 *    - Copies the file to the new location
 *    - Updates the file entry with the new S3 key
 *    - Deletes the file from the old location
 * 3. Processes in batches for memory efficiency
 */

import type { Migration, MigrationResult } from '../migration-types';
import { validateS3Config, buildS3Key, copyObject, deleteFile as deleteS3File, fileExists } from '../lib/s3-utils';
import { getAllFiles, updateFile } from '../lib/file-manager';

/**
 * Error categorization for migration
 */
interface MigrationError {
  fileId: string;
  filename: string;
  error: string;
  oldKey?: string;
  newKey?: string;
}

/**
 * Categories used in the old key format (uppercase)
 */
const OLD_CATEGORIES = ['IMAGE', 'DOCUMENT', 'AVATAR', 'ATTACHMENT', 'EXPORT'];

/**
 * Check if an S3 key is in the old format
 * Old format: {prefix}users/{userId}/{CATEGORY}/{fileId}_{filename}
 * New format: {prefix}users/{userId}/{projectId}/... or {prefix}users/{userId}/_general/...
 */
function isOldFormatKey(s3Key: string): boolean {
  // Find the path after "users/{userId}/"
  const usersMatch = s3Key.match(/users\/[^/]+\/([^/]+)\//);
  if (!usersMatch) {
    // Can't determine format, assume it needs migration
    return true;
  }

  const thirdSegment = usersMatch[1];

  // If it starts with _general, it's new format
  if (thirdSegment === '_general') {
    return false;
  }

  // If it's an old category (uppercase), it's old format
  if (OLD_CATEGORIES.includes(thirdSegment)) {
    return true;
  }

  // Otherwise, assume it's new format (projectId)
  return false;
}

/**
 * Count files that need migration (have old-format S3 keys)
 */
async function countFilesToMigrate(): Promise<number> {
  try {
    const files = await getAllFiles();
    return files.filter(entry => entry.s3Key && isOldFormatKey(entry.s3Key)).length;
  } catch {
    return 0;
  }
}

/**
 * Restructure S3 Keys migration
 */
export const restructureS3KeysMigration: Migration = {
  id: 'restructure-s3-keys-v1',
  description: 'Restructure S3 keys to use project/folder-based paths',
  introducedInVersion: '2.6.0',
  dependsOn: ['migrate-files-to-s3-v1'],

  async shouldRun(): Promise<boolean> {
    const s3Config = validateS3Config();

    // Check if S3 is properly configured
    if (!s3Config.isConfigured) {
      console.log('[migration.restructure-s3-keys] S3 is not properly configured, skipping');
      return false;
    }

    // Check if there are files to migrate
    const filesToMigrate = await countFilesToMigrate();
    if (filesToMigrate === 0) {
      console.log('[migration.restructure-s3-keys] No files need S3 key restructuring');
      return false;
    }

    console.log('[migration.restructure-s3-keys] Files need S3 key restructuring', {
      count: filesToMigrate,
    });

    return true;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    const BATCH_SIZE = 50;

    let migrated = 0;
    let skipped = 0;
    const errors: MigrationError[] = [];

    try {
      console.log('[migration.restructure-s3-keys] Starting S3 key restructuring');

      // Get all files
      const allFiles = await getAllFiles();
      const filesToMigrate = allFiles.filter(entry => entry.s3Key && isOldFormatKey(entry.s3Key));

      console.log('[migration.restructure-s3-keys] Found files to migrate', {
        total: allFiles.length,
        toMigrate: filesToMigrate.length,
      });

      // Process in batches
      for (let i = 0; i < filesToMigrate.length; i += BATCH_SIZE) {
        const batch = filesToMigrate.slice(i, i + BATCH_SIZE);

        console.log('[migration.restructure-s3-keys] Processing batch', {
          batchStart: i,
          batchSize: batch.length,
          progress: `${i}/${filesToMigrate.length}`,
        });

        for (const entry of batch) {
          const oldS3Key = entry.s3Key!;

          try {
            // Build new S3 key
            const newS3Key = buildS3Key({
              userId: entry.userId,
              fileId: entry.id,
              filename: entry.originalFilename,
              projectId: entry.projectId ?? null,
              folderPath: entry.folderPath ?? '/',
            });

            // Skip if key hasn't changed
            if (newS3Key === oldS3Key) {
              skipped++;
              console.log('[migration.restructure-s3-keys] Key unchanged, skipping', {
                fileId: entry.id,
                key: oldS3Key,
              });
              continue;
            }

            // Check if source file exists
            const sourceExists = await fileExists(oldS3Key);
            if (!sourceExists) {
              errors.push({
                fileId: entry.id,
                filename: entry.originalFilename,
                error: 'Source file not found in S3',
                oldKey: oldS3Key,
              });
              console.warn('[migration.restructure-s3-keys] Source file not found', {
                fileId: entry.id,
                oldS3Key,
              });
              continue;
            }

            // Copy to new location
            console.log('[migration.restructure-s3-keys] Copying file', {
              fileId: entry.id,
              from: oldS3Key,
              to: newS3Key,
            });

            await copyObject(oldS3Key, newS3Key);

            // Update metadata
            await updateFile(entry.id, {
              s3Key: newS3Key,
              updatedAt: new Date().toISOString(),
            });

            // Delete old file
            try {
              await deleteS3File(oldS3Key);
              console.log('[migration.restructure-s3-keys] Deleted old S3 object', {
                fileId: entry.id,
                oldS3Key,
              });
            } catch (deleteError) {
              // Log but don't fail - the migration succeeded, old file is just orphaned
              console.warn('[migration.restructure-s3-keys] Failed to delete old S3 object', {
                fileId: entry.id,
                oldS3Key,
                error: deleteError instanceof Error ? deleteError.message : 'Unknown error',
              });
            }

            migrated++;
            console.log('[migration.restructure-s3-keys] File migrated successfully', {
              fileId: entry.id,
              oldS3Key,
              newS3Key,
            });
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            errors.push({
              fileId: entry.id,
              filename: entry.originalFilename,
              error: errorMessage,
              oldKey: oldS3Key,
            });
            console.error('[migration.restructure-s3-keys] Failed to migrate file', {
              fileId: entry.id,
              oldS3Key,
              error: errorMessage,
            });
          }
        }
      }
    } catch (error) {
      console.error('[migration.restructure-s3-keys] Failed to initialize migration', error instanceof Error ? error : undefined);

      return {
        id: 'restructure-s3-keys-v1',
        success: false,
        itemsAffected: migrated,
        message: 'Failed to initialize S3 key restructuring',
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    const success = errors.length === 0;
    const durationMs = Date.now() - startTime;

    if (success) {
      console.log('[migration.restructure-s3-keys] S3 key restructuring completed successfully', {
        filesMigrated: migrated,
        filesSkipped: skipped,
        durationMs,
      });
    } else {
      console.warn('[migration.restructure-s3-keys] S3 key restructuring completed with errors', {
        filesMigrated: migrated,
        filesSkipped: skipped,
        errorCount: errors.length,
        durationMs,
      });
    }

    // Build message
    let message = `Restructured ${migrated} file S3 keys`;
    if (skipped > 0) {
      message += `, skipped ${skipped} unchanged`;
    }
    if (errors.length > 0) {
      message += `, ${errors.length} errors`;
    }

    return {
      id: 'restructure-s3-keys-v1',
      success,
      itemsAffected: migrated,
      message,
      error: errors.length > 0
        ? errors
            .slice(0, 5)
            .map(e => `${e.fileId}: ${e.error}`)
            .join('; ')
        : undefined,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  },
};
