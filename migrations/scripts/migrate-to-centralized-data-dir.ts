/**
 * Migration: Migrate to Centralized Data Directory
 *
 * This migration moves legacy data from old locations to the new platform-specific
 * centralized data directory:
 *
 * Legacy locations:
 * - ./data/quilltap.db (project-relative)
 * - ~/.quilltap/data/quilltap.db (home-relative, used before on all platforms)
 * - ./logs/*.log (project-relative)
 * - ~/.quilltap/files (Linux-style, on macOS/Windows)
 *
 * New platform-specific locations:
 * - Linux: ~/.quilltap/data, ~/.quilltap/files, ~/.quilltap/logs
 * - macOS: ~/Library/Application Support/Quilltap/data, files, logs
 * - Windows: %APPDATA%\Quilltap\data, files, logs
 * - Docker: /app/quilltap/data, /app/quilltap/files, /app/quilltap/logs
 *
 * The migration uses marker files (.MIGRATED) to prevent re-migration on subsequent
 * startups and to preserve original data as a backup.
 *
 * Migration ID: migrate-to-centralized-data-dir-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  getPlatform,
  getBaseDataDir,
  getDataDir,
  getFilesDir,
  getLogsDir,
  getLegacyPaths,
  hasLegacyData,
  hasMigrationMarker,
  createMigrationMarker,
  ensureDataDirectoriesExist,
} from '../../lib/paths';
import {
  isMongoDBBackend,
  isSQLiteBackend,
  getSQLiteDatabase,
  querySQLite,
  sqliteTableExists,
} from '../lib/database-utils';

/**
 * Copy a directory recursively
 */
function copyDirectoryRecursive(source: string, target: string): { success: boolean; filesCopied: number; error?: string } {
  let filesCopied = 0;

  try {
    // Ensure target directory exists
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
    }

    const entries = fs.readdirSync(source, { withFileTypes: true });

    for (const entry of entries) {
      const sourcePath = path.join(source, entry.name);
      const targetPath = path.join(target, entry.name);

      // Skip marker files
      if (entry.name === '.MIGRATED') {
        continue;
      }

      if (entry.isDirectory()) {
        const result = copyDirectoryRecursive(sourcePath, targetPath);
        if (!result.success) {
          return result;
        }
        filesCopied += result.filesCopied;
      } else {
        // Skip if target already exists
        if (fs.existsSync(targetPath)) {
          logger.info('Skipping existing file', {
            context: 'migration.centralized-data-dir',
            file: targetPath,
          });
          continue;
        }

        fs.copyFileSync(sourcePath, targetPath);
        filesCopied++;
      }
    }

    return { success: true, filesCopied };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, filesCopied, error: errorMessage };
  }
}

/**
 * Find which legacy data directory has the database
 * Returns the path to use for migration, or null if none found
 */
function findLegacyDataDir(): string | null {
  const legacy = getLegacyPaths();
  const currentDataDir = getDataDir();
  const platform = getPlatform();

  // Check project-relative ./data first
  const projectDbPath = path.join(legacy.projectDataDir, 'quilltap.db');
  if (fs.existsSync(projectDbPath)) {
    if (path.resolve(legacy.projectDataDir) !== path.resolve(currentDataDir)) {
      return legacy.projectDataDir;
    }
  }

  // Check home-relative ~/.quilltap/data (important for macOS/Windows migration)
  if (platform === 'darwin' || platform === 'win32') {
    const homeDbPath = path.join(legacy.homeDataDir, 'quilltap.db');
    if (fs.existsSync(homeDbPath)) {
      if (path.resolve(legacy.homeDataDir) !== path.resolve(currentDataDir)) {
        return legacy.homeDataDir;
      }
    }
  }

  return null;
}

/**
 * Update existing mount points that reference old ~/.quilltap/files path
 */
async function updateMountPointPaths(): Promise<{ updated: number; errors: string[] }> {
  const platform = getPlatform();
  let updated = 0;
  const errors: string[] = [];

  // Only relevant on macOS/Windows where the default path changed
  if (platform !== 'darwin' && platform !== 'win32') {
    return { updated, errors };
  }

  const homeDir = os.homedir();
  const oldFilesPath = path.join(homeDir, '.quilltap', 'files');
  const newFilesPath = getFilesDir();

  // If paths are the same (due to QUILLTAP_DATA_DIR override), skip
  if (path.resolve(oldFilesPath) === path.resolve(newFilesPath)) {
    return { updated, errors };
  }

  if (isMongoDBBackend()) {
    try {
      const { getMongoDatabase } = await import('../lib/mongodb-utils');
      const db = await getMongoDatabase();
      const collection = db.collection('mount_points');

      // Find mount points with old basePath
      const cursor = collection.find({
        'backendConfig.basePath': oldFilesPath,
      });

      while (await cursor.hasNext()) {
        const mp = await cursor.next();
        if (!mp) continue;

        try {
          await collection.updateOne(
            { _id: mp._id },
            {
              $set: {
                'backendConfig.basePath': newFilesPath,
                updatedAt: new Date().toISOString(),
              },
            }
          );
          updated++;

          logger.info('Updated mount point basePath', {
            context: 'migration.centralized-data-dir',
            mountPointId: mp.id,
            oldPath: oldFilesPath,
            newPath: newFilesPath,
          });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          errors.push(`Mount point ${mp.id}: ${errorMsg}`);
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push(`MongoDB mount point update failed: ${errorMsg}`);
    }
  } else if (isSQLiteBackend()) {
    try {
      if (!sqliteTableExists('mount_points')) {
        return { updated, errors };
      }

      const mountPoints = querySQLite<{ id: string; backendConfig: string }>(
        'SELECT id, backendConfig FROM mount_points WHERE backendType = ?',
        ['local']
      );

      const db = getSQLiteDatabase();
      const updateStmt = db.prepare(
        'UPDATE mount_points SET backendConfig = ?, updatedAt = ? WHERE id = ?'
      );

      for (const mp of mountPoints) {
        try {
          const config = JSON.parse(mp.backendConfig);
          if (config.basePath === oldFilesPath) {
            config.basePath = newFilesPath;
            updateStmt.run(
              JSON.stringify(config),
              new Date().toISOString(),
              mp.id
            );
            updated++;

            logger.info('Updated mount point basePath', {
              context: 'migration.centralized-data-dir',
              mountPointId: mp.id,
              oldPath: oldFilesPath,
              newPath: newFilesPath,
            });
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          errors.push(`Mount point ${mp.id}: ${errorMsg}`);
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push(`SQLite mount point update failed: ${errorMsg}`);
    }
  }

  return { updated, errors };
}

/**
 * Migrate to Centralized Data Directory Migration
 */
export const migrateToCentralizedDataDirMigration: Migration = {
  id: 'migrate-to-centralized-data-dir-v1',
  description: 'Migrate legacy data from old locations to platform-specific centralized data directory',
  introducedInVersion: '2.8.0',
  // Run after mount points migration since we may need to update mount point paths
  dependsOn: ['create-mount-points-v1'],

  async shouldRun(): Promise<boolean> {
    const platform = getPlatform();

    // Docker uses /app/* which hasn't changed, so no migration needed
    if (platform === 'docker') {
      logger.info('Skipping data directory migration in Docker environment', {
        context: 'migration.centralized-data-dir',
      });
      return false;
    }

    // Check if any legacy data exists that hasn't been migrated
    const legacy = getLegacyPaths();
    const legacyStatus = hasLegacyData();

    // Find which legacy data directory to migrate from
    const legacyDataDir = findLegacyDataDir();

    // Check for marker files
    const dataAlreadyMigrated = legacyDataDir ? hasMigrationMarker(legacyDataDir) : true;
    const logsAlreadyMigrated = legacyStatus.logs && hasMigrationMarker(legacy.logsDir);
    const filesAlreadyMigrated = legacyStatus.files && hasMigrationMarker(legacy.filesDir);

    // Determine if there's unmigrated data
    const hasUnmigratedData = legacyDataDir !== null && !dataAlreadyMigrated;
    const hasUnmigratedLogs = legacyStatus.logs && !logsAlreadyMigrated;
    const hasUnmigratedFiles = legacyStatus.files && !filesAlreadyMigrated;

    const needsRun = hasUnmigratedData || hasUnmigratedLogs || hasUnmigratedFiles;

    if (needsRun) {
      logger.info('Legacy data detected, migration needed', {
        context: 'migration.centralized-data-dir',
        platform,
        legacyDataDir,
        hasData: legacyDataDir !== null,
        dataAlreadyMigrated,
        hasLogs: legacyStatus.logs,
        logsAlreadyMigrated,
        hasFiles: legacyStatus.files,
        filesAlreadyMigrated,
      });
    }

    return needsRun;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let itemsAffected = 0;

    const platform = getPlatform();
    const legacy = getLegacyPaths();
    const newDataDir = getDataDir();
    const newFilesDir = getFilesDir();
    const newLogsDir = getLogsDir();

    // Find which legacy data directory to migrate from
    const legacyDataDir = findLegacyDataDir();

    logger.info('Starting centralized data directory migration', {
      context: 'migration.centralized-data-dir',
      platform,
      legacyDataDir,
      legacyLogsDir: legacy.logsDir,
      legacyFilesDir: legacy.filesDir,
      newDataDir,
      newFilesDir,
      newLogsDir,
    });

    // Ensure new directories exist
    ensureDataDirectoriesExist();

    // Step 1: Migrate data directory to new location
    if (legacyDataDir && !hasMigrationMarker(legacyDataDir)) {
      logger.info('Migrating data directory', {
        context: 'migration.centralized-data-dir',
        from: legacyDataDir,
        to: newDataDir,
      });

      const result = copyDirectoryRecursive(legacyDataDir, newDataDir);
      if (result.success) {
        itemsAffected += result.filesCopied;
        createMigrationMarker(legacyDataDir, newDataDir);

        logger.info('Data directory migrated successfully', {
          context: 'migration.centralized-data-dir',
          filesCopied: result.filesCopied,
        });
      } else {
        errors.push(`Data migration failed: ${result.error}`);
        logger.error('Data directory migration failed', {
          context: 'migration.centralized-data-dir',
          error: result.error,
        });
      }
    }

    // Step 2: Migrate ./logs to new location
    const legacyStatus = hasLegacyData();
    if (legacyStatus.logs && !hasMigrationMarker(legacy.logsDir)) {
      logger.info('Migrating logs directory', {
        context: 'migration.centralized-data-dir',
        from: legacy.logsDir,
        to: newLogsDir,
      });

      const result = copyDirectoryRecursive(legacy.logsDir, newLogsDir);
      if (result.success) {
        itemsAffected += result.filesCopied;
        createMigrationMarker(legacy.logsDir, newLogsDir);

        logger.info('Logs directory migrated successfully', {
          context: 'migration.centralized-data-dir',
          filesCopied: result.filesCopied,
        });
      } else {
        errors.push(`Logs migration failed: ${result.error}`);
        logger.error('Logs directory migration failed', {
          context: 'migration.centralized-data-dir',
          error: result.error,
        });
      }
    }

    // Step 3: Migrate ~/.quilltap/files on macOS/Windows
    if (legacyStatus.files && !hasMigrationMarker(legacy.filesDir)) {
      logger.info('Migrating files directory', {
        context: 'migration.centralized-data-dir',
        from: legacy.filesDir,
        to: newFilesDir,
      });

      const result = copyDirectoryRecursive(legacy.filesDir, newFilesDir);
      if (result.success) {
        itemsAffected += result.filesCopied;
        createMigrationMarker(legacy.filesDir, newFilesDir);

        logger.info('Files directory migrated successfully', {
          context: 'migration.centralized-data-dir',
          filesCopied: result.filesCopied,
        });
      } else {
        errors.push(`Files migration failed: ${result.error}`);
        logger.error('Files directory migration failed', {
          context: 'migration.centralized-data-dir',
          error: result.error,
        });
      }
    }

    // Step 4: Update mount point paths in database
    const mountPointResult = await updateMountPointPaths();
    itemsAffected += mountPointResult.updated;
    errors.push(...mountPointResult.errors);

    const success = errors.length === 0;
    const durationMs = Date.now() - startTime;

    logger.info('Centralized data directory migration completed', {
      context: 'migration.centralized-data-dir',
      success,
      itemsAffected,
      errorCount: errors.length,
      durationMs,
    });

    return {
      id: 'migrate-to-centralized-data-dir-v1',
      success,
      itemsAffected,
      message: success
        ? `Migrated ${itemsAffected} items to centralized data directory`
        : `Migration completed with ${errors.length} errors`,
      error: errors.length > 0 ? errors.join('; ') : undefined,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  },
};
