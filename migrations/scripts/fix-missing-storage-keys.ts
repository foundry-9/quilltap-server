/**
 * Migration: Fix Missing Storage Keys
 *
 * Fixes files that have s3Key but no storageKey.
 * This can happen if:
 * - The create-mount-points migration didn't run properly
 * - Files were created with s3Key before the storageKey field existed
 * - The migration ran but skipped files for some reason
 *
 * This migration simply copies s3Key → storageKey for any files where
 * storageKey is null/missing but s3Key exists.
 *
 * Migration ID: fix-missing-storage-keys-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { getMongoDatabase, isMongoDBBackend } from '../lib/mongodb-utils';

/**
 * Check if MongoDB is accessible
 */
async function isMongoDBAccessible(): Promise<boolean> {
  try {
    const db = await getMongoDatabase();
    await db.command({ ping: 1 });
    return true;
  } catch (error) {
    logger.warn('MongoDB is not accessible for fix-missing-storage-keys migration', {
      context: 'migration.fix-missing-storage-keys',
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Count files that need migration
 */
async function countFilesNeedingMigration(): Promise<number> {
  try {
    const db = await getMongoDatabase();
    const filesCollection = db.collection('files');

    // Find files with s3Key but no storageKey
    const count = await filesCollection.countDocuments({
      s3Key: { $exists: true, $ne: null },
      $or: [
        { storageKey: { $exists: false } },
        { storageKey: null },
      ],
    });

    return count;
  } catch (error) {
    logger.error('Error counting files needing storage key migration', {
      context: 'migration.fix-missing-storage-keys',
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/**
 * Fix Missing Storage Keys Migration
 */
export const fixMissingStorageKeysMigration: Migration = {
  id: 'fix-missing-storage-keys-v1',
  description: 'Copy s3Key to storageKey for files missing storageKey',
  introducedInVersion: '2.7.0',
  dependsOn: ['create-mount-points-v1'],

  async shouldRun(): Promise<boolean> {
    // Only run if MongoDB is enabled
    if (!isMongoDBBackend()) {
      return false;
    }

    // Check if MongoDB is accessible
    if (!(await isMongoDBAccessible())) {
      return false;
    }

    // Check if there are files to fix
    const count = await countFilesNeedingMigration();
    return count > 0;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let filesUpdated = 0;
    const errors: Array<{ fileId: string; error: string }> = [];

    logger.info('Starting fix-missing-storage-keys migration', {
      context: 'migration.fix-missing-storage-keys',
    });

    try {
      const db = await getMongoDatabase();
      const filesCollection = db.collection('files');

      // Find files with s3Key but no storageKey
      const filesCursor = filesCollection.find({
        s3Key: { $exists: true, $ne: null },
        $or: [
          { storageKey: { $exists: false } },
          { storageKey: null },
        ],
      });

      while (await filesCursor.hasNext()) {
        const file = await filesCursor.next();
        if (!file) continue;

        try {
          await filesCollection.updateOne(
            { _id: file._id },
            {
              $set: {
                storageKey: file.s3Key,
                updatedAt: new Date().toISOString(),
              },
            }
          );

          filesUpdated++;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push({
            fileId: file.id as string,
            error: errorMessage,
          });
          logger.error('Failed to fix storage key for file', {
            context: 'migration.fix-missing-storage-keys',
            fileId: file.id,
            error: errorMessage,
          });
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Fix-missing-storage-keys migration failed', {
        context: 'migration.fix-missing-storage-keys',
        error: errorMessage,
      });

      return {
        id: 'fix-missing-storage-keys-v1',
        success: false,
        itemsAffected: filesUpdated,
        message: `Migration failed: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    const success = errors.length === 0;
    const durationMs = Date.now() - startTime;

    logger.info('Fix-missing-storage-keys migration completed', {
      context: 'migration.fix-missing-storage-keys',
      filesUpdated,
      errors: errors.length,
      durationMs,
    });

    return {
      id: 'fix-missing-storage-keys-v1',
      success,
      itemsAffected: filesUpdated,
      message: success
        ? `Fixed storageKey for ${filesUpdated} files`
        : `Fixed ${filesUpdated} files with ${errors.length} errors`,
      error: errors.length > 0
        ? `Errors: ${errors.slice(0, 5).map(e => `${e.fileId}: ${e.error}`).join('; ')}`
        : undefined,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  },
};
