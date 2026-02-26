/**
 * Migration: Restructure File Storage
 *
 * Moves physical files from the old storage key layout to the new layout,
 * and updates the corresponding DB records.
 *
 * Old storage key format:
 *   users/{userId}/{projectId or '_general'}/{folderPath}/{fileId}_{sanitizedFilename}
 *
 * New storage key format:
 *   {projectId or '_general'}/{folderPath}/{safeFilename}
 *
 * Old thumbnail path:
 *   users/{userId}/thumbnails/{fileId}_{size}.webp
 *
 * New thumbnail path:
 *   _thumbnails/{fileId}_{size}.webp
 *
 * Also removes any legacy .meta.json sidecar files, and cleans up the
 * now-empty users/ directory tree once all files have been moved.
 *
 * Migration ID: restructure-file-storage-v1
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

/**
 * Parse an old-format storage key into its component parts.
 *
 * Old format: users/{userId}/{projectId or '_general'}/{folderPath...}/{fileId}_{sanitizedFilename}
 *
 * Returns null if the key does not match the old format.
 */
function parseOldStorageKey(storageKey: string): {
  userId: string;
  projectId: string | null;
  folderPath: string;
  fileId: string;
  sanitizedFilename: string;
} | null {
  // Must start with "users/"
  if (!storageKey.startsWith('users/')) {
    return null;
  }

  const parts = storageKey.split('/');
  // Minimum: users / userId / projectOrGeneral / fileId_filename
  if (parts.length < 4) {
    return null;
  }

  const userId = parts[1];
  const projectOrGeneral = parts[2];

  // The last segment is "{fileId}_{sanitizedFilename}"
  const lastSegment = parts[parts.length - 1];
  const underscoreIndex = lastSegment.indexOf('_');
  if (underscoreIndex < 0) {
    // Cannot parse fileId prefix — treat entire segment as filename
    return {
      userId,
      projectId: projectOrGeneral === '_general' ? null : projectOrGeneral,
      folderPath: parts.slice(3, parts.length - 1).join('/'),
      fileId: '',
      sanitizedFilename: lastSegment,
    };
  }

  const fileId = lastSegment.slice(0, underscoreIndex);
  const sanitizedFilename = lastSegment.slice(underscoreIndex + 1);

  // Intermediate segments (between projectOrGeneral and the filename) form the folder path
  const folderPath = parts.slice(3, parts.length - 1).join('/');

  return {
    userId,
    projectId: projectOrGeneral === '_general' ? null : projectOrGeneral,
    folderPath,
    fileId,
    sanitizedFilename,
  };
}

/**
 * Build the new storage key for a file.
 *
 * New format: {projectId or '_general'}/{folderPath}/{safeFilename}
 */
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

/**
 * Resolve a collision-free storage key by checking whether the target path
 * already exists on disk and appending " (N)" before the extension if needed.
 *
 * Returns the chosen storage key (may have a numeric suffix).
 */
async function resolveCollisionFreeKey(
  filesDir: string,
  baseKey: string
): Promise<string> {
  const targetPath = path.join(filesDir, baseKey);

  try {
    await fsPromises.access(targetPath);
    // File already exists — try suffixed variants
  } catch {
    // File does not exist — base key is free
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

    const suffixedPath = path.join(filesDir, suffixed);
    try {
      await fsPromises.access(suffixedPath);
      // Still exists — try next
    } catch {
      return suffixed;
    }
  }

  // Extreme fallback: timestamp suffix
  const ts = Date.now();
  if (dotIndex > 0) {
    return `${baseKey.slice(0, dotIndex)}_${ts}${baseKey.slice(dotIndex)}`;
  }
  return `${baseKey}_${ts}`;
}

/**
 * Recursively remove an empty directory tree.
 *
 * Removes directories bottom-up, stopping when a directory is non-empty
 * or we reach the files root.
 */
async function removeEmptyDirs(dirPath: string, stopAt: string): Promise<void> {
  if (path.resolve(dirPath) === path.resolve(stopAt)) {
    return;
  }

  let entries: fsSync.Dirent[];
  try {
    entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  if (entries.length > 0) {
    return;
  }

  try {
    await fsPromises.rmdir(dirPath);
    logger.debug('Removed empty directory', {
      context: 'migration.restructure-file-storage',
      dir: dirPath,
    });
    await removeEmptyDirs(path.dirname(dirPath), stopAt);
  } catch {
    // Non-fatal — directory may have become non-empty concurrently
  }
}

// ============================================================================
// shouldRun check
// ============================================================================

/**
 * Known legacy category-based directory names that need migration.
 * These were used in older versions where files were stored as
 * `{CATEGORY}/{fileId}_{filename}` instead of the new layout.
 */
const LEGACY_CATEGORY_DIRS = [
  'IMAGE', 'ATTACHMENT', 'DOCUMENT', 'REPORT', 'AUDIO', 'VIDEO',
  'image', 'attachment', 'document', 'report', 'audio', 'video',
];

/**
 * Returns true if:
 *   - Any DB file record has a storageKey starting with "users/", OR
 *   - A "users/" directory exists inside the files directory, OR
 *   - Any legacy category directories (IMAGE/, ATTACHMENT/, etc.) exist, OR
 *   - Any DB records use category-based storageKeys
 */
async function checkNeedsRun(filesDir: string): Promise<boolean> {
  // Check filesystem first (quick, no DB needed)
  const usersDir = path.join(filesDir, 'users');
  if (fsSync.existsSync(usersDir)) {
    logger.debug('Found legacy users/ directory in files dir', {
      context: 'migration.restructure-file-storage',
      usersDir,
    });
    return true;
  }

  // Check for legacy category directories
  for (const cat of LEGACY_CATEGORY_DIRS) {
    if (fsSync.existsSync(path.join(filesDir, cat))) {
      logger.debug('Found legacy category directory in files dir', {
        context: 'migration.restructure-file-storage',
        category: cat,
      });
      return true;
    }
  }

  // Check DB records
  if (!isSQLiteBackend()) {
    return false;
  }

  if (!sqliteTableExists('files')) {
    return false;
  }

  // Check for users/ prefix
  const oldFormatRows = querySQLite<{ count: number }>(
    `SELECT COUNT(*) AS count FROM files WHERE storageKey LIKE 'users/%'`
  );

  const count = oldFormatRows[0]?.count ?? 0;
  if (count > 0) {
    logger.debug('Found DB file records with old-format storageKeys', {
      context: 'migration.restructure-file-storage',
      count,
    });
    return true;
  }

  // Check for category-based keys (IMAGE/, ATTACHMENT/, etc.)
  const categoryPattern = LEGACY_CATEGORY_DIRS.map(c => `storageKey LIKE '${c}/%'`).join(' OR ');
  const categoryRows = querySQLite<{ count: number }>(
    `SELECT COUNT(*) AS count FROM files WHERE ${categoryPattern}`
  );

  const categoryCount = categoryRows[0]?.count ?? 0;
  if (categoryCount > 0) {
    logger.debug('Found DB file records with category-based storageKeys', {
      context: 'migration.restructure-file-storage',
      count: categoryCount,
    });
    return true;
  }

  return false;
}

// ============================================================================
// Migration
// ============================================================================

export const restructureFileStorageMigration: Migration = {
  id: 'restructure-file-storage-v1',
  description:
    'Move physical files and thumbnails from old users/{userId}/... layout to new flat layout, update DB storageKeys',
  introducedInVersion: '3.2.0',
  dependsOn: ['add-file-status-field-v1'],

  async shouldRun(): Promise<boolean> {
    const filesDir = getFilesDir();
    return checkNeedsRun(filesDir);
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let filesRelocated = 0;
    let thumbnailsMoved = 0;
    let sidecarFilesRemoved = 0;
    let dbRecordsUpdated = 0;

    const filesDir = getFilesDir();

    logger.info('Starting file storage restructure migration', {
      context: 'migration.restructure-file-storage',
      filesDir,
    });

    // ------------------------------------------------------------------
    // Step 1: Migrate file records with old-format storageKeys
    // ------------------------------------------------------------------

    if (isSQLiteBackend() && sqliteTableExists('files')) {
      const oldRecords = querySQLite<FileRecord>(
        `SELECT id, storageKey, originalFilename, projectId, folderPath
         FROM files
         WHERE storageKey LIKE 'users/%'`
      );

      logger.info('Found file records with old-format storageKeys', {
        context: 'migration.restructure-file-storage',
        count: oldRecords.length,
      });

      const db = getSQLiteDatabase();
      const updateStmt = db.prepare(
        `UPDATE files SET storageKey = ?, updatedAt = ? WHERE id = ?`
      );

      // Wrap all DB updates in a single transaction for atomicity and speed.
      // We still copy files outside the transaction (disk I/O cannot be
      // rolled back), but we defer DB updates until all copies succeed per
      // record so partial failures leave the DB unchanged for that record.
      const dbUpdates: Array<{ id: string; newKey: string }> = [];

      for (const record of oldRecords) {
        try {
          const parsed = parseOldStorageKey(record.storageKey);

          // Determine what filename to use for the new key.
          // Prefer originalFilename from the DB record (it carries the real
          // name the user uploaded). Fall back to whatever was stored in
          // the old sanitized portion of the storageKey if needed.
          const filenameForKey =
            record.originalFilename ||
            (parsed ? parsed.sanitizedFilename : record.id);

          // The project/folder come from the DB record (authoritative),
          // falling back to what we parsed from the key.
          const effectiveProjectId =
            record.projectId ?? (parsed ? parsed.projectId : null);
          const effectiveFolderPath =
            record.folderPath ?? (parsed ? parsed.folderPath || null : null);

          const baseNewKey = buildNewStorageKey(
            filenameForKey,
            effectiveProjectId,
            effectiveFolderPath
          );

          // Resolve collisions on the filesystem
          const newKey = await resolveCollisionFreeKey(filesDir, baseNewKey);

          const oldPhysicalPath = path.join(filesDir, record.storageKey);
          const newPhysicalPath = path.join(filesDir, newKey);

          // Only copy if the old file actually exists on disk
          const oldFileExists = fsSync.existsSync(oldPhysicalPath);

          if (oldFileExists) {
            // Ensure target directory exists
            await fsPromises.mkdir(path.dirname(newPhysicalPath), {
              recursive: true,
            });

            // Copy first — then delete old after DB is updated
            await fsPromises.copyFile(oldPhysicalPath, newPhysicalPath);

            filesRelocated++;

            logger.debug('Copied file to new location', {
              context: 'migration.restructure-file-storage',
              fileId: record.id,
              from: record.storageKey,
              to: newKey,
            });
          } else {
            logger.warn('Old physical file not found on disk; updating DB key only', {
              context: 'migration.restructure-file-storage',
              fileId: record.id,
              missingPath: record.storageKey,
              newKey,
            });
          }

          // Queue the DB update
          dbUpdates.push({ id: record.id, newKey });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`File ${record.id}: ${msg}`);
          logger.error('Failed to relocate file', {
            context: 'migration.restructure-file-storage',
            fileId: record.id,
            storageKey: record.storageKey,
            error: msg,
          });
        }
      }

      // Apply all DB updates in a single transaction
      if (dbUpdates.length > 0) {
        const now = new Date().toISOString();
        const runTransaction = db.transaction(() => {
          for (const { id, newKey } of dbUpdates) {
            updateStmt.run(newKey, now, id);
            dbRecordsUpdated++;
          }
        });

        try {
          runTransaction();

          logger.info('DB storageKey updates committed', {
            context: 'migration.restructure-file-storage',
            count: dbRecordsUpdated,
          });

          // Now that DB is updated, remove the old physical files.
          // We do this after the DB commit so that if something fails here
          // the DB is still consistent (new key) and the extra file on disk
          // is harmless — a subsequent run won't re-process it.
          for (const record of oldRecords) {
            if (!dbUpdates.find((u) => u.id === record.id)) {
              // This record had an error; skip cleanup
              continue;
            }

            const oldPhysicalPath = path.join(filesDir, record.storageKey);
            if (fsSync.existsSync(oldPhysicalPath)) {
              try {
                await fsPromises.unlink(oldPhysicalPath);
              } catch (unlinkErr) {
                const msg =
                  unlinkErr instanceof Error
                    ? unlinkErr.message
                    : String(unlinkErr);
                logger.warn('Could not remove old file after copy', {
                  context: 'migration.restructure-file-storage',
                  fileId: record.id,
                  path: record.storageKey,
                  error: msg,
                });
                // Non-fatal — the old file being left behind is harmless
              }

              // Remove accompanying .meta.json sidecar if present
              const metaPath = oldPhysicalPath + '.meta.json';
              if (fsSync.existsSync(metaPath)) {
                try {
                  await fsPromises.unlink(metaPath);
                  sidecarFilesRemoved++;
                } catch {
                  // Non-fatal
                }
              }
            }
          }
        } catch (txErr) {
          const msg = txErr instanceof Error ? txErr.message : String(txErr);
          errors.push(`DB transaction failed: ${msg}`);
          logger.error('DB storageKey transaction failed', {
            context: 'migration.restructure-file-storage',
            error: msg,
          });
        }
      }
    }

    // ------------------------------------------------------------------
    // Step 2: Migrate category-based storage keys (IMAGE/, ATTACHMENT/, etc.)
    // ------------------------------------------------------------------

    if (isSQLiteBackend() && sqliteTableExists('files')) {
      const categoryPattern = LEGACY_CATEGORY_DIRS.map(c => `storageKey LIKE '${c}/%'`).join(' OR ');
      const categoryRecords = querySQLite<FileRecord>(
        `SELECT id, storageKey, originalFilename, projectId, folderPath
         FROM files
         WHERE ${categoryPattern}`
      );

      if (categoryRecords.length > 0) {
        logger.info('Found file records with category-based storageKeys', {
          context: 'migration.restructure-file-storage',
          count: categoryRecords.length,
        });

        const db = getSQLiteDatabase();
        const catUpdateStmt = db.prepare(
          `UPDATE files SET storageKey = ?, updatedAt = ? WHERE id = ?`
        );

        const catDbUpdates: Array<{ id: string; newKey: string; oldKey: string }> = [];

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
                context: 'migration.restructure-file-storage',
                fileId: record.id,
                from: record.storageKey,
                to: newKey,
              });
            }

            catDbUpdates.push({ id: record.id, newKey, oldKey: record.storageKey });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`Category file ${record.id}: ${msg}`);
            logger.error('Failed to relocate category file', {
              context: 'migration.restructure-file-storage',
              fileId: record.id,
              storageKey: record.storageKey,
              error: msg,
            });
          }
        }

        if (catDbUpdates.length > 0) {
          const now = new Date().toISOString();
          const runCatTransaction = db.transaction(() => {
            for (const { id, newKey } of catDbUpdates) {
              catUpdateStmt.run(newKey, now, id);
              dbRecordsUpdated++;
            }
          });

          try {
            runCatTransaction();

            // Delete old files after DB commit
            for (const { oldKey } of catDbUpdates) {
              const oldPath = path.join(filesDir, oldKey);
              if (fsSync.existsSync(oldPath)) {
                try {
                  await fsPromises.unlink(oldPath);
                } catch {
                  // Non-fatal
                }
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
    // Step 3: Move thumbnails from users/ tree to _thumbnails/
    //         Handles both thumbnails/ subdirs AND thumbnail files mixed
    //         in with regular files (the _thumb_ pattern)
    // ------------------------------------------------------------------

    const usersDir = path.join(filesDir, 'users');
    const newThumbsDir = path.join(filesDir, '_thumbnails');
    const thumbPattern = /_thumb_\d+_/;

    if (fsSync.existsSync(usersDir)) {
      logger.info('Scanning for legacy thumbnails under users/', {
        context: 'migration.restructure-file-storage',
        usersDir,
      });

      /**
       * Recursively find and move thumbnail files from a directory tree.
       * Handles both dedicated thumbnails/ directories and _thumb_ pattern files
       * scattered alongside regular files.
       */
      async function moveThumbnailsRecursively(dir: string): Promise<void> {
        let entries: fsSync.Dirent[];
        try {
          entries = await fsPromises.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }

        for (const entry of entries) {
          const entryPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            await moveThumbnailsRecursively(entryPath);
            continue;
          }

          if (!entry.isFile()) continue;

          // Check if this is a thumbnail file (either in a thumbnails/ dir
          // or matching the _thumb_ naming pattern)
          const inThumbsDir = dir.endsWith('/thumbnails') || dir.includes('/thumbnails/');
          const isThumbFile = thumbPattern.test(entry.name) || entry.name.endsWith('.webp');

          if (inThumbsDir || (isThumbFile && thumbPattern.test(entry.name))) {
            const newThumbPath = path.join(newThumbsDir, entry.name);
            try {
              if (!fsSync.existsSync(newThumbPath)) {
                await fsPromises.mkdir(newThumbsDir, { recursive: true });
                await fsPromises.copyFile(entryPath, newThumbPath);
              }
              await fsPromises.unlink(entryPath);
              thumbnailsMoved++;
            } catch (thumbErr) {
              const msg = thumbErr instanceof Error ? thumbErr.message : String(thumbErr);
              logger.warn('Failed to move thumbnail', {
                context: 'migration.restructure-file-storage',
                name: entry.name,
                error: msg,
              });
            }
          }
        }
      }

      await moveThumbnailsRecursively(usersDir);
    }

    // ------------------------------------------------------------------
    // Step 4: Remove .meta.json sidecars and .DS_Store files from
    //         the users/ tree and legacy category directories
    // ------------------------------------------------------------------

    const junkPattern = /\.(meta\.json|DS_Store)$/;

    async function removeJunkRecursively(dir: string): Promise<void> {
      let entries: fsSync.Dirent[];
      try {
        entries = await fsPromises.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await removeJunkRecursively(entryPath);
        } else if (entry.isFile() && junkPattern.test(entry.name)) {
          try {
            await fsPromises.unlink(entryPath);
            if (entry.name.endsWith('.meta.json')) {
              sidecarFilesRemoved++;
            }
          } catch {
            // Non-fatal
          }
        }
      }
    }

    if (fsSync.existsSync(usersDir)) {
      await removeJunkRecursively(usersDir);
    }

    // Also clean junk from legacy category directories
    for (const cat of LEGACY_CATEGORY_DIRS) {
      const catDir = path.join(filesDir, cat);
      if (fsSync.existsSync(catDir)) {
        await removeJunkRecursively(catDir);
      }
    }

    // ------------------------------------------------------------------
    // Step 5: Clean up empty directory trees (users/ and category dirs)
    // ------------------------------------------------------------------

    /**
     * Walk a directory tree bottom-up, removing empty directories.
     * Returns true if the directory itself was removed.
     */
    async function cleanEmptyTree(dir: string): Promise<boolean> {
      let entries: fsSync.Dirent[];
      try {
        entries = await fsPromises.readdir(dir, { withFileTypes: true });
      } catch {
        return false;
      }

      // Recursively clean children first
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
          logger.debug('Removed empty directory', {
            context: 'migration.restructure-file-storage',
            dir,
          });
          return true;
        } catch {
          return false;
        }
      }

      return false;
    }

    // Clean the users/ tree
    if (fsSync.existsSync(usersDir)) {
      await cleanEmptyTree(usersDir);

      if (!fsSync.existsSync(usersDir)) {
        logger.info('Removed legacy users/ directory tree', {
          context: 'migration.restructure-file-storage',
          usersDir,
        });
      } else {
        // Log what's remaining for debugging
        logger.info('Legacy users/ directory still contains files after migration', {
          context: 'migration.restructure-file-storage',
          usersDir,
          note: 'Remaining files may need manual cleanup',
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
            context: 'migration.restructure-file-storage',
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
    const itemsAffected = filesRelocated + thumbnailsMoved + dbRecordsUpdated;

    logger.info('File storage restructure migration completed', {
      context: 'migration.restructure-file-storage',
      success,
      filesRelocated,
      thumbnailsMoved,
      sidecarFilesRemoved,
      dbRecordsUpdated,
      errorCount: errors.length,
      durationMs,
    });

    return {
      id: 'restructure-file-storage-v1',
      success,
      itemsAffected,
      message: success
        ? `Restructured file storage: ${filesRelocated} file(s) relocated, ` +
          `${thumbnailsMoved} thumbnail(s) moved, ${dbRecordsUpdated} DB record(s) updated`
        : `Migration completed with ${errors.length} error(s): ` +
          `${filesRelocated} file(s) relocated, ${thumbnailsMoved} thumbnail(s) moved, ` +
          `${dbRecordsUpdated} DB record(s) updated`,
      error: errors.length > 0 ? errors.join('; ') : undefined,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  },
};
