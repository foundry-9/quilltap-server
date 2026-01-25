/**
 * Migration: Per-Project Mount Points
 *
 * This migration updates the schema to support per-project mount points:
 * - Removes the isProjectDefault field from all mount points (no longer used)
 * - Adds an index on projects.mountPointId for efficient lookups
 *
 * Migration ID: per-project-mount-points-v1
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
    logger.warn('MongoDB is not accessible for per-project mount points migration', {
      context: 'migration.per-project-mount-points',
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Check if migration needs to run
 */
async function needsMigration(): Promise<boolean> {
  try {
    const db = await getMongoDatabase();
    const mountPointsCollection = db.collection('mount_points');

    // Check if any mount points still have isProjectDefault field
    const hasIsProjectDefault = await mountPointsCollection.findOne({
      isProjectDefault: { $exists: true },
    });

    return hasIsProjectDefault !== null;
  } catch (error) {
    return false;
  }
}

/**
 * Per-Project Mount Points Migration
 */
export const perProjectMountPointsMigration: Migration = {
  id: 'per-project-mount-points-v1',
  description: 'Remove isProjectDefault from mount points and add projects.mountPointId index',
  introducedInVersion: '2.8.0',
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

    return needsMigration();
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let mountPointsUpdated = 0;
    let indexCreated = false;
    const errors: string[] = [];

    logger.info('Starting per-project mount points migration', {
      context: 'migration.per-project-mount-points',
    });

    try {
      const db = await getMongoDatabase();
      const mountPointsCollection = db.collection('mount_points');
      const projectsCollection = db.collection('projects');

      // Step 1: Remove isProjectDefault from all mount points
      const updateResult = await mountPointsCollection.updateMany(
        { isProjectDefault: { $exists: true } },
        { $unset: { isProjectDefault: '' } }
      );
      mountPointsUpdated = updateResult.modifiedCount;
      // Step 2: Drop the isProjectDefault index if it exists
      try {
        await mountPointsCollection.dropIndex('isProjectDefault_1');
      } catch (indexError) {
        // Index might not exist, which is fine
      }

      // Step 3: Add index on projects.mountPointId
      try {
        await projectsCollection.createIndex(
          { mountPointId: 1 },
          { sparse: true, background: true }
        );
        indexCreated = true;
      } catch (indexError) {
        // Index might already exist
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Per-project mount points migration failed', {
        context: 'migration.per-project-mount-points',
        error: errorMessage,
      });

      return {
        id: 'per-project-mount-points-v1',
        success: false,
        itemsAffected: mountPointsUpdated,
        message: `Migration failed: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    const success = errors.length === 0;
    const durationMs = Date.now() - startTime;

    logger.info('Per-project mount points migration completed', {
      context: 'migration.per-project-mount-points',
      success,
      mountPointsUpdated,
      indexCreated,
      durationMs,
    });

    return {
      id: 'per-project-mount-points-v1',
      success,
      itemsAffected: mountPointsUpdated,
      message: `Removed isProjectDefault from ${mountPointsUpdated} mount points, index created: ${indexCreated}`,
      error: errors.length > 0 ? errors.join('; ') : undefined,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  },
};
