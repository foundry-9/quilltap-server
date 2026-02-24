/**
 * Migration: Drop Mount Points
 *
 * Removes the mount points system entirely:
 * - DROP TABLE mount_points
 * - ALTER TABLE files DROP COLUMN mountPointId, s3Key, s3Bucket
 * - ALTER TABLE projects DROP COLUMN mountPointId
 * - ALTER TABLE folders DROP COLUMN mountPointId
 *
 * Leaves storageKey intact on files (still used for local storage).
 *
 * SQLite 3.35+ supports ALTER TABLE DROP COLUMN, and better-sqlite3
 * bundles SQLite 3.45+, so this is safe.
 *
 * Migration ID: drop-mount-points-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

/**
 * Check if there is work to do
 */
function needsWork(): boolean {
  if (!isSQLiteBackend()) {
    return false;
  }

  // Check if mount_points table still exists
  if (sqliteTableExists('mount_points')) {
    return true;
  }

  // Check if files table still has mountPointId column
  if (sqliteTableExists('files')) {
    const columns = getSQLiteTableColumns('files');
    if (columns.some(c => c.name === 'mountPointId' || c.name === 's3Key' || c.name === 's3Bucket')) {
      return true;
    }
  }

  // Check if projects table still has mountPointId column
  if (sqliteTableExists('projects')) {
    const columns = getSQLiteTableColumns('projects');
    if (columns.some(c => c.name === 'mountPointId')) {
      return true;
    }
  }

  return false;
}

/**
 * Run migration
 */
function runMigration(): MigrationResult {
  const startTime = Date.now();
  let itemsAffected = 0;

  try {
    const db = getSQLiteDatabase();

    // Drop mount_points table
    if (sqliteTableExists('mount_points')) {
      db.exec('DROP TABLE IF EXISTS mount_points');
      itemsAffected++;
      logger.info('Dropped mount_points table', {
        context: 'migration.drop-mount-points',
      });
    }

    // Drop columns from files table
    if (sqliteTableExists('files')) {
      const fileColumns = getSQLiteTableColumns('files');
      const columnsToDrop = ['mountPointId', 's3Key', 's3Bucket'];

      for (const colName of columnsToDrop) {
        if (fileColumns.some(c => c.name === colName)) {
          db.exec(`ALTER TABLE files DROP COLUMN "${colName}"`);
          itemsAffected++;
          logger.info(`Dropped column ${colName} from files table`, {
            context: 'migration.drop-mount-points',
          });
        }
      }
    }

    // Drop mountPointId from projects table
    if (sqliteTableExists('projects')) {
      const projectColumns = getSQLiteTableColumns('projects');
      if (projectColumns.some(c => c.name === 'mountPointId')) {
        db.exec('ALTER TABLE projects DROP COLUMN "mountPointId"');
        itemsAffected++;
        logger.info('Dropped mountPointId from projects table', {
          context: 'migration.drop-mount-points',
        });
      }
    }

    // Drop mountPointId from folders table
    if (sqliteTableExists('folders')) {
      const folderColumns = getSQLiteTableColumns('folders');
      if (folderColumns.some(c => c.name === 'mountPointId')) {
        db.exec('ALTER TABLE folders DROP COLUMN "mountPointId"');
        itemsAffected++;
        logger.info('Dropped mountPointId from folders table', {
          context: 'migration.drop-mount-points',
        });
      }
    }

    const durationMs = Date.now() - startTime;

    return {
      id: 'drop-mount-points-v1',
      success: true,
      itemsAffected,
      message: `Removed mount points system: ${itemsAffected} schema changes`,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Drop mount points migration failed', {
      context: 'migration.drop-mount-points',
      error: errorMessage,
    });

    return {
      id: 'drop-mount-points-v1',
      success: false,
      itemsAffected,
      message: `Migration failed: ${errorMessage}`,
      error: errorMessage,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Drop Mount Points Migration
 */
export const dropMountPointsMigration: Migration = {
  id: 'drop-mount-points-v1',
  description: 'Remove mount points table and related columns from files, projects, and folders',
  introducedInVersion: '2.9.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }
    return needsWork();
  },

  async run(): Promise<MigrationResult> {
    logger.info('Starting drop mount points migration', {
      context: 'migration.drop-mount-points',
    });
    return runMigration();
  },
};
