/**
 * Filesystem Reconciliation
 *
 * Full scan + DB sync run on startup.
 * Ensures the database accurately reflects what's on disk.
 *
 * Logic:
 * 1. Scan entire files directory (excluding _thumbnails)
 * 2. Load all file DB records
 * 3. For each file on disk: match to DB by storageKey, create orphaned record if missing
 * 4. For each DB record not on disk: delete the DB record
 * 5. Log summary
 *
 * @module file-storage/reconciliation
 */

import { join } from 'path';
import { createLogger } from '@/lib/logging/create-logger';
import { getFilesDir } from '@/lib/paths';
import { scanDirectory, computeSha256, detectMimeType } from './scanner';

const logger = createLogger('file-storage:reconciliation');

// ============================================================================
// RECONCILIATION
// ============================================================================

/**
 * Reconcile the filesystem with the database.
 *
 * This is designed to run at startup, after file storage is initialized
 * but before the watcher starts.
 */
export async function reconcileFilesystem(): Promise<void> {
  const startTime = Date.now();
  const filesDir = getFilesDir();

  logger.info('Starting filesystem reconciliation', { filesDir });

  let filesOnDisk = 0;
  let recordsCreated = 0;
  let recordsDeleted = 0;
  let recordsUpdated = 0;
  let errors = 0;

  try {
    // Lazy imports to avoid circular dependencies during startup
    const { getRepositories } = await import('@/lib/database/repositories');
    const { getOrCreateSingleUser } = await import('@/lib/auth/single-user');

    const repos = getRepositories();
    const user = await getOrCreateSingleUser();
    const userId = user.id;

    // Step 1: Scan filesystem
    const scanned = await scanDirectory(filesDir);
    const filesOnlyScanned = scanned.filter(f => !f.isDirectory);
    filesOnDisk = filesOnlyScanned.length;

    // Step 2: Load all file DB records
    const allDbFiles = await repos.files.findByUserId(userId);

    // Build lookup maps
    const dbByStorageKey = new Map<string, any>();
    for (const f of allDbFiles) {
      if (f.storageKey) {
        dbByStorageKey.set(f.storageKey, f);
      }
    }

    const diskKeySet = new Set<string>();

    // Step 3: For each file on disk, ensure a DB record exists
    for (const scannedFile of filesOnlyScanned) {
      diskKeySet.add(scannedFile.relativePath);

      if (dbByStorageKey.has(scannedFile.relativePath)) {
        // Record exists — check if size needs updating
        const dbRecord = dbByStorageKey.get(scannedFile.relativePath);
        if (dbRecord.size !== scannedFile.size) {
          try {
            const sha256 = await computeSha256(join(filesDir, scannedFile.relativePath));
            await repos.files.update(dbRecord.id, {
              sha256,
              size: scannedFile.size,
            });
            recordsUpdated++;
          } catch (err) {
            errors++;
            logger.warn('Failed to update file record during reconciliation', {
              storageKey: scannedFile.relativePath,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        continue;
      }

      // No DB record — create one as orphaned
      try {
        const absolutePath = join(filesDir, scannedFile.relativePath);
        const sha256 = await computeSha256(absolutePath);
        const mimeType = detectMimeType(scannedFile.name);

        // Parse projectId and folderPath from path
        const parts = scannedFile.relativePath.split('/');
        const projectOrGeneral = parts[0];
        const projectId = projectOrGeneral === '_general' ? null : projectOrGeneral;
        const folderPath = parts.length > 2
          ? '/' + parts.slice(1, parts.length - 1).join('/') + '/'
          : '/';

        await repos.files.create({
          userId,
          sha256,
          originalFilename: scannedFile.name,
          mimeType,
          size: scannedFile.size,
          linkedTo: [],
          source: 'UPLOADED',
          category: mimeType.startsWith('image/') ? 'IMAGE' : 'DOCUMENT',
          storageKey: scannedFile.relativePath,
          projectId,
          folderPath,
          tags: [],
          fileStatus: 'orphaned',
        });
        recordsCreated++;
      } catch (err) {
        errors++;
        logger.warn('Failed to create orphaned record during reconciliation', {
          storageKey: scannedFile.relativePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Step 4: For each DB record not on disk, delete it
    for (const dbFile of allDbFiles) {
      if (!dbFile.storageKey) continue;

      if (!diskKeySet.has(dbFile.storageKey)) {
        try {
          await repos.files.delete(dbFile.id);
          recordsDeleted++;

          logger.debug('Deleted DB record for missing file', {
            fileId: dbFile.id,
            storageKey: dbFile.storageKey,
            filename: dbFile.originalFilename,
          });
        } catch (err) {
          errors++;
          logger.warn('Failed to delete stale record during reconciliation', {
            fileId: dbFile.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    const durationMs = Date.now() - startTime;
    logger.info('Filesystem reconciliation complete', {
      filesOnDisk,
      dbRecords: allDbFiles.length,
      recordsCreated,
      recordsDeleted,
      recordsUpdated,
      errors,
      durationMs,
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logger.error('Filesystem reconciliation failed', {
      error: error instanceof Error ? error.message : String(error),
      durationMs,
    });
  }
}
