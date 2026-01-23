/**
 * Migration: Cleanup Orphan File Records
 *
 * Removes file records from the database that have no storage reference.
 * These are files where:
 * - storageKey is null/missing AND
 * - s3Key is null/missing
 *
 * Such records typically result from failed uploads where the database record
 * was created but the file was never successfully uploaded to S3.
 *
 * Migration ID: cleanup-orphan-file-records-v1
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
    logger.warn('MongoDB is not accessible for cleanup-orphan-file-records migration', {
      context: 'migration.cleanup-orphan-file-records',
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Count orphan file records
 */
async function countOrphanFiles(): Promise<number> {
  try {
    const db = await getMongoDatabase();
    const filesCollection = db.collection('files');

    // Find files with neither storageKey nor s3Key
    const count = await filesCollection.countDocuments({
      $and: [
        {
          $or: [
            { storageKey: { $exists: false } },
            { storageKey: null },
            { storageKey: '' },
          ],
        },
        {
          $or: [
            { s3Key: { $exists: false } },
            { s3Key: null },
            { s3Key: '' },
          ],
        },
      ],
    });

    return count;
  } catch (error) {
    logger.error('Error counting orphan file records', {
      context: 'migration.cleanup-orphan-file-records',
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/**
 * Cleanup Orphan File Records Migration
 */
export const cleanupOrphanFileRecordsMigration: Migration = {
  id: 'cleanup-orphan-file-records-v1',
  description: 'Remove file records with no storage reference (no storageKey and no s3Key)',
  introducedInVersion: '2.7.0',
  dependsOn: ['fix-missing-storage-keys-v1'],

  async shouldRun(): Promise<boolean> {
    // Only run if MongoDB is enabled
    if (!isMongoDBBackend()) {
      logger.debug('MongoDB not enabled, skipping cleanup-orphan-file-records migration', {
        context: 'migration.cleanup-orphan-file-records',
      });
      return false;
    }

    // Check if MongoDB is accessible
    if (!(await isMongoDBAccessible())) {
      logger.debug('MongoDB not accessible, deferring cleanup-orphan-file-records migration', {
        context: 'migration.cleanup-orphan-file-records',
      });
      return false;
    }

    // Check if there are orphan files to clean up
    const count = await countOrphanFiles();

    logger.debug('Checked for orphan file records', {
      context: 'migration.cleanup-orphan-file-records',
      count,
    });

    return count > 0;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let filesDeleted = 0;
    const deletedFileIds: string[] = [];
    const errors: Array<{ fileId: string; error: string }> = [];

    logger.info('Starting cleanup-orphan-file-records migration', {
      context: 'migration.cleanup-orphan-file-records',
    });

    try {
      const db = await getMongoDatabase();
      const filesCollection = db.collection('files');

      // Find orphan files
      const orphanFiles = await filesCollection
        .find({
          $and: [
            {
              $or: [
                { storageKey: { $exists: false } },
                { storageKey: null },
                { storageKey: '' },
              ],
            },
            {
              $or: [
                { s3Key: { $exists: false } },
                { s3Key: null },
                { s3Key: '' },
              ],
            },
          ],
        })
        .toArray();

      for (const file of orphanFiles) {
        try {
          const fileId = file.id as string;

          logger.debug('Deleting orphan file record', {
            context: 'migration.cleanup-orphan-file-records',
            fileId,
            filename: file.filename,
            createdAt: file.createdAt,
          });

          await filesCollection.deleteOne({ _id: file._id });

          filesDeleted++;
          deletedFileIds.push(fileId);

          logger.info('Deleted orphan file record', {
            context: 'migration.cleanup-orphan-file-records',
            fileId,
            filename: file.filename,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push({
            fileId: file.id as string,
            error: errorMessage,
          });
          logger.error('Failed to delete orphan file record', {
            context: 'migration.cleanup-orphan-file-records',
            fileId: file.id,
            error: errorMessage,
          });
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Cleanup-orphan-file-records migration failed', {
        context: 'migration.cleanup-orphan-file-records',
        error: errorMessage,
      });

      return {
        id: 'cleanup-orphan-file-records-v1',
        success: false,
        itemsAffected: filesDeleted,
        message: `Migration failed: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    const success = errors.length === 0;
    const durationMs = Date.now() - startTime;

    logger.info('Cleanup-orphan-file-records migration completed', {
      context: 'migration.cleanup-orphan-file-records',
      filesDeleted,
      deletedFileIds: deletedFileIds.slice(0, 10),
      errors: errors.length,
      durationMs,
    });

    return {
      id: 'cleanup-orphan-file-records-v1',
      success,
      itemsAffected: filesDeleted,
      message: success
        ? `Deleted ${filesDeleted} orphan file records`
        : `Deleted ${filesDeleted} file records with ${errors.length} errors`,
      error: errors.length > 0
        ? `Errors: ${errors.slice(0, 5).map(e => `${e.fileId}: ${e.error}`).join('; ')}`
        : undefined,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  },
};
