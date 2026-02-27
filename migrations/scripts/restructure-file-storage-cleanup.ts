/**
 * Migration: Restructure File Storage — Cleanup Pass
 *
 * Handles edge cases the initial restructure migration missed:
 *
 * 1. Category-based storage keys (IMAGE/, ATTACHMENT/, REPORT/, etc.)
 *    that don't start with "users/" but still need migration
 * 2. Old thumbnail files stored alongside regular files in the users/
 *    tree (with _thumb_ naming pattern), not in a dedicated thumbnails/ dir
 * 3. .DS_Store files on macOS preventing empty directory cleanup
 * 4. Remaining files under users/ that didn't have matching DB records
 *
 * Migration ID: restructure-file-storage-cleanup-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import fsSync from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { getFilesDir } from '../../lib/paths';
import { safeFilename } from '../../lib/file-storage/manager';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  querySQLite,
  sqliteTableExists,
} from '../lib/database-utils';

// ============================================================================
// Constants
// ============================================================================

/**
 * Known legacy category-based directory names.
 */
const LEGACY_CATEGORY_DIRS = [
  'IMAGE', 'ATTACHMENT', 'DOCUMENT', 'REPORT', 'AUDIO', 'VIDEO',
  'image', 'attachment', 'document', 'report', 'audio', 'video',
];

/** Pattern matching thumbnail filenames: {uuid}_thumb_{size}_{uuid}_{size}.webp */
const THUMB_PATTERN = /_thumb_\d+_/;

/** Files we should delete silently during cleanup */
const JUNK_PATTERN = /\.(meta\.json|DS_Store)$/;

// ============================================================================
// Types
// ============================================================================

interface FileRecord {
  id: string;
  storageKey: string;
  originalFilename: string;
  projectId: string | null;
  folderPath: string | null;
}

// ============================================================================
// Helpers
// ============================================================================

function buildNewStorageKey(
  filename: string,
  projectId: string | null,
  folderPath: string | null | undefined
): string {
  const safe = safeFilename(filename);
  const projectPath = projectId ? projectId : '_general';
  const folder = folderPath ? folderPath.replace(/^\/+|\/+$/g, '') : '';

  const pathParts = [projectPath];
  if (folder) {
    pathParts.push(folder);
  }

  return `${pathParts.join('/')}/${safe}`;
}

async function resolveCollisionFreeKey(
  filesDir: string,
  baseKey: string
): Promise<string> {
  const targetPath = path.join(filesDir, baseKey);

  try {
    await fsPromises.access(targetPath);
  } catch {
    return baseKey;
  }

  const dotIndex = baseKey.lastIndexOf('.');
  for (let attempt = 2; attempt <= 999; attempt++) {
    let suffixed: string;
    if (dotIndex > 0) {
      suffixed = `${baseKey.slice(0, dotIndex)} (${attempt})${baseKey.slice(dotIndex)}`;
    } else {
      suffixed = `${baseKey} (${attempt})`;
    }

    try {
      await fsPromises.access(path.join(filesDir, suffixed));
    } catch {
      return suffixed;
    }
  }

  const ts = Date.now();
  if (dotIndex > 0) {
    return `${baseKey.slice(0, dotIndex)}_${ts}${baseKey.slice(dotIndex)}`;
  }
  return `${baseKey}_${ts}`;
}

/**
 * Recursively collect all files in a directory tree.
 */
async function collectFilesRecursively(dir: string, relativeTo: string): Promise<Array<{
  absolutePath: string;
  relativePath: string;
  name: string;
}>> {
  const results: Array<{ absolutePath: string; relativePath: string; name: string }> = [];
  let entries: fsSync.Dirent[];
  try {
    entries = await fsPromises.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const children = await collectFilesRecursively(entryPath, relativeTo);
      results.push(...children);
    } else if (entry.isFile()) {
      results.push({
        absolutePath: entryPath,
        relativePath: path.relative(relativeTo, entryPath),
        name: entry.name,
      });
    }
  }

  return results;
}

/**
 * Walk a directory tree bottom-up, removing empty directories.
 */
async function cleanEmptyTree(dir: string): Promise<boolean> {
  let entries: fsSync.Dirent[];
  try {
    entries = await fsPromises.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      await cleanEmptyTree(path.join(dir, entry.name));
    }
  }

  // Re-read after cleaning children
  try {
    entries = await fsPromises.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }

  if (entries.length === 0) {
    try {
      await fsPromises.rmdir(dir);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

// ============================================================================
// shouldRun check
// ============================================================================

async function checkNeedsRun(filesDir: string): Promise<boolean> {
  // Check for users/ directory
  if (fsSync.existsSync(path.join(filesDir, 'users'))) {
    return true;
  }

  // Check for legacy category directories
  for (const cat of LEGACY_CATEGORY_DIRS) {
    if (fsSync.existsSync(path.join(filesDir, cat))) {
      return true;
    }
  }

  // Check for .meta.json files in _thumbnails/
  const thumbsDir = path.join(filesDir, '_thumbnails');
  if (fsSync.existsSync(thumbsDir)) {
    try {
      const entries = fsSync.readdirSync(thumbsDir);
      if (entries.some(e => e.endsWith('.meta.json'))) {
        return true;
      }
    } catch {
      // Non-fatal
    }
  }

  // Check for category-based DB records
  if (isSQLiteBackend() && sqliteTableExists('files')) {
    const conditions = LEGACY_CATEGORY_DIRS.map(c => `storageKey LIKE '${c}/%'`).join(' OR ');
    const rows = querySQLite<{ count: number }>(
      `SELECT COUNT(*) AS count FROM files WHERE ${conditions}`
    );
    if ((rows[0]?.count ?? 0) > 0) {
      return true;
    }
  }

  return false;
}

// ============================================================================
// Migration
// ============================================================================

export const restructureFileStorageCleanupMigration: Migration = {
  id: 'restructure-file-storage-cleanup-v1',
  description:
    'Clean up remaining legacy file storage artifacts: category dirs, orphaned thumbnails, .DS_Store files',
  introducedInVersion: '3.2.0',
  dependsOn: ['restructure-file-storage-v1'],

  async shouldRun(): Promise<boolean> {
    const filesDir = getFilesDir();
    return checkNeedsRun(filesDir);
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let filesRelocated = 0;
    let thumbnailsMoved = 0;
    let junkFilesRemoved = 0;
    let dbRecordsUpdated = 0;

    const filesDir = getFilesDir();

    logger.info('Starting file storage cleanup migration', {
      context: 'migration.restructure-file-storage-cleanup',
      filesDir,
    });

    // ------------------------------------------------------------------
    // Step 1: Migrate category-based storage keys in DB
    // ------------------------------------------------------------------

    if (isSQLiteBackend() && sqliteTableExists('files')) {
      const conditions = LEGACY_CATEGORY_DIRS.map(c => `storageKey LIKE '${c}/%'`).join(' OR ');
      const categoryRecords = querySQLite<FileRecord>(
        `SELECT id, storageKey, originalFilename, projectId, folderPath
         FROM files WHERE ${conditions}`
      );

      if (categoryRecords.length > 0) {
        logger.info('Found file records with category-based storageKeys', {
          context: 'migration.restructure-file-storage-cleanup',
          count: categoryRecords.length,
        });

        const db = getSQLiteDatabase();
        const updateStmt = db.prepare(
          `UPDATE files SET storageKey = ?, updatedAt = ? WHERE id = ?`
        );

        const dbUpdates: Array<{ id: string; newKey: string; oldKey: string }> = [];

        for (const record of categoryRecords) {
          try {
            const filenameForKey = record.originalFilename || path.basename(record.storageKey);
            const baseNewKey = buildNewStorageKey(
              filenameForKey,
              record.projectId,
              record.folderPath
            );
            const newKey = await resolveCollisionFreeKey(filesDir, baseNewKey);

            const oldPhysicalPath = path.join(filesDir, record.storageKey);
            const newPhysicalPath = path.join(filesDir, newKey);

            if (fsSync.existsSync(oldPhysicalPath)) {
              await fsPromises.mkdir(path.dirname(newPhysicalPath), { recursive: true });
              await fsPromises.copyFile(oldPhysicalPath, newPhysicalPath);
              filesRelocated++;

              logger.debug('Copied category file to new location', {
                context: 'migration.restructure-file-storage-cleanup',
                fileId: record.id,
                from: record.storageKey,
                to: newKey,
              });
            }

            dbUpdates.push({ id: record.id, newKey, oldKey: record.storageKey });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`Category file ${record.id}: ${msg}`);
          }
        }

        if (dbUpdates.length > 0) {
          const now = new Date().toISOString();
          try {
            const runTransaction = db.transaction(() => {
              for (const { id, newKey } of dbUpdates) {
                updateStmt.run(newKey, now, id);
                dbRecordsUpdated++;
              }
            });
            runTransaction();

            // Delete old files after DB commit
            for (const { oldKey } of dbUpdates) {
              const oldPath = path.join(filesDir, oldKey);
              try {
                if (fsSync.existsSync(oldPath)) {
                  await fsPromises.unlink(oldPath);
                }
              } catch {
                // Non-fatal
              }
            }
          } catch (txErr) {
            const msg = txErr instanceof Error ? txErr.message : String(txErr);
            errors.push(`Category DB transaction failed: ${msg}`);
          }
        }
      }
    }

    // ------------------------------------------------------------------
    // Step 2: Move thumbnail files from users/ tree to _thumbnails/
    // ------------------------------------------------------------------

    const usersDir = path.join(filesDir, 'users');
    const newThumbsDir = path.join(filesDir, '_thumbnails');

    if (fsSync.existsSync(usersDir)) {
      const allUsersFiles = await collectFilesRecursively(usersDir, usersDir);

      for (const file of allUsersFiles) {
        // Check if it's a thumbnail (in a thumbnails/ dir or matching _thumb_ pattern)
        const inThumbsDir = file.relativePath.includes('/thumbnails/');
        const isThumbFile = THUMB_PATTERN.test(file.name);

        if (inThumbsDir || isThumbFile) {
          const destPath = path.join(newThumbsDir, file.name);
          try {
            await fsPromises.mkdir(newThumbsDir, { recursive: true });
            if (!fsSync.existsSync(destPath)) {
              await fsPromises.copyFile(file.absolutePath, destPath);
            }
            await fsPromises.unlink(file.absolutePath);
            thumbnailsMoved++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn('Failed to move thumbnail', {
              context: 'migration.restructure-file-storage-cleanup',
              name: file.name,
              error: msg,
            });
          }
        }
      }
    }

    // ------------------------------------------------------------------
    // Step 3: Remove junk files (.DS_Store, .meta.json) from legacy dirs
    // ------------------------------------------------------------------

    const legacyDirs = [
      usersDir,
      newThumbsDir,
      ...LEGACY_CATEGORY_DIRS.map(c => path.join(filesDir, c)),
    ];

    for (const legacyDir of legacyDirs) {
      if (!fsSync.existsSync(legacyDir)) continue;

      const files = await collectFilesRecursively(legacyDir, legacyDir);
      for (const file of files) {
        if (JUNK_PATTERN.test(file.name)) {
          try {
            await fsPromises.unlink(file.absolutePath);
            junkFilesRemoved++;
          } catch {
            // Non-fatal
          }
        }
      }
    }

    // ------------------------------------------------------------------
    // Step 4: Delete remaining old files under users/ that are duplicates
    //         of already-migrated files (the originals that weren't cleaned up)
    // ------------------------------------------------------------------

    if (fsSync.existsSync(usersDir)) {
      const remainingFiles = await collectFilesRecursively(usersDir, usersDir);

      for (const file of remainingFiles) {
        // These are files that still exist under users/ but whose DB
        // records have already been migrated to new paths. They're just
        // leftover copies. Safe to delete.
        try {
          await fsPromises.unlink(file.absolutePath);
          junkFilesRemoved++;

          logger.debug('Removed leftover file from users/ tree', {
            context: 'migration.restructure-file-storage-cleanup',
            path: file.relativePath,
          });
        } catch {
          // Non-fatal
        }
      }
    }

    // ------------------------------------------------------------------
    // Step 5: Clean up empty directories
    // ------------------------------------------------------------------

    // Clean users/ tree
    if (fsSync.existsSync(usersDir)) {
      await cleanEmptyTree(usersDir);
      if (!fsSync.existsSync(usersDir)) {
        logger.info('Removed legacy users/ directory tree', {
          context: 'migration.restructure-file-storage-cleanup',
        });
      }
    }

    // Clean legacy category directories
    for (const cat of LEGACY_CATEGORY_DIRS) {
      const catDir = path.join(filesDir, cat);
      if (fsSync.existsSync(catDir)) {
        await cleanEmptyTree(catDir);
        if (!fsSync.existsSync(catDir)) {
          logger.info('Removed legacy category directory', {
            context: 'migration.restructure-file-storage-cleanup',
            category: cat,
          });
        }
      }
    }

    // ------------------------------------------------------------------
    // Summary
    // ------------------------------------------------------------------

    const success = errors.length === 0;
    const durationMs = Date.now() - startTime;
    const itemsAffected = filesRelocated + thumbnailsMoved + junkFilesRemoved + dbRecordsUpdated;

    logger.info('File storage cleanup migration completed', {
      context: 'migration.restructure-file-storage-cleanup',
      success,
      filesRelocated,
      thumbnailsMoved,
      junkFilesRemoved,
      dbRecordsUpdated,
      errorCount: errors.length,
      durationMs,
    });

    return {
      id: 'restructure-file-storage-cleanup-v1',
      success,
      itemsAffected,
      message: success
        ? `Cleaned up file storage: ${filesRelocated} file(s) relocated, ` +
          `${thumbnailsMoved} thumbnail(s) moved, ${junkFilesRemoved} junk file(s) removed, ` +
          `${dbRecordsUpdated} DB record(s) updated`
        : `Cleanup completed with ${errors.length} error(s): ` +
          `${filesRelocated} file(s) relocated, ${junkFilesRemoved} junk file(s) removed`,
      error: errors.length > 0 ? errors.join('; ') : undefined,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  },
};
