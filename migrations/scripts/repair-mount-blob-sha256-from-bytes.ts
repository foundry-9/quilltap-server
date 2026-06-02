/**
 * Migration: Repair drifted `doc_mount_blobs.sha256` by recomputing from stored bytes
 *
 * Prior to this fix, certain upload paths (writeProjectFileToMountStore,
 * writeUserUploadToMountStore, writeLanternBackgroundToMountStore,
 * writeCharacterAvatarToVault) transcoded bitmap uploads to WebP before
 * persisting them, then recorded a `sha256` derived from the *input* bytes
 * rather than the *stored* bytes.  Because `doc_mount_blobs.sha256` is used
 * as the content-identity fingerprint for the blob, a mismatch between the
 * recorded sha and the bytes on the shelf can cause silent integrity errors,
 * incorrect deduplication, and consumers receiving mismatched metadata.
 *
 * This migration walks every `doc_mount_blobs` row, fetches its `data` BLOB,
 * recomputes the sha256 from those bytes, and — when the computed sha differs
 * from the recorded one — UPDATEs both `doc_mount_blobs.sha256` and the
 * paired `doc_mount_files.sha256` (joined via `doc_mount_blobs.fileId`) in a
 * single atomic transaction.
 *
 * `files.sha256` in the MAIN database is intentionally *not* touched: that
 * column records the input-bytes hash used at upload time for deduplication
 * via `findBySha256`, and rewriting it to the stored-bytes sha would silently
 * break deduplication of same-source re-uploads.  See the companion migration
 * `repair-files-mime-and-size-from-mount-blob-v1` for context.
 *
 * Idempotent: rows already in agreement are skipped.  Rows whose `data` BLOB
 * is empty or NULL are logged as orphans and left untouched — they are a
 * separate cleanup problem.
 *
 * Migration ID: repair-mount-blob-sha256-from-bytes-v1
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import { isSQLiteBackend } from '../lib/database-utils';
import { getMountIndexDatabasePath } from '../../lib/paths';
import { getRawMountIndexDatabase } from '../../lib/database/backends/sqlite/mount-index-client';
import { sha256OfBuffer } from '../../lib/utils/sha256';

const MIGRATION_ID = 'repair-mount-blob-sha256-from-bytes-v1';
const BATCH_SIZE = 500;

/**
 * Returns a usable mount-index DB handle plus whether we own it.
 *
 * When the app already holds a live mount-index connection (the common case
 * once any mount has been touched), reuse it rather than opening a second
 * SQLCipher handle to the same encrypted file. Only when no live connection
 * exists do we open — and therefore own and must close — our own keyed
 * connection. Reusing the live handle is also what makes this migration
 * unit-testable against an injected in-memory DB.
 */
function openMountIndexDb(): { db: DatabaseType; owned: boolean } | null {
  const existing = getRawMountIndexDatabase();
  if (existing) return { db: existing as unknown as DatabaseType, owned: false };

  const dbPath = getMountIndexDatabasePath();
  if (!fs.existsSync(path.dirname(dbPath))) return null;
  if (!fs.existsSync(dbPath)) return null;
  const db = new Database(dbPath);
  try {
    const pepper = process.env.ENCRYPTION_MASTER_PEPPER;
    if (pepper) {
      const keyHex = Buffer.from(pepper, 'base64').toString('hex');
      db.pragma(`key = "x'${keyHex}'"`);
    }
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
    return { db, owned: true };
  } catch (error) {
    try { db.close(); } catch { /* ignore */ }
    throw error;
  }
}

interface BlobIdRow {
  id: string;
  fileId: string;
  sha256: string;
}

export const repairMountBlobSha256FromBytesMigration: Migration = {
  id: MIGRATION_ID,
  description:
    'Recompute doc_mount_blobs.sha256 from stored bytes and align doc_mount_files.sha256; the upload paths recorded the input-bytes hash instead of the stored-bytes hash',
  introducedInVersion: '4.6.0',
  dependsOn: [
    'relink-files-to-mount-blobs-v1',
    'repair-files-mime-and-size-from-mount-blob-v1',
  ],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    const dbPath = getMountIndexDatabasePath();
    if (!fs.existsSync(dbPath)) return false;

    // Open the mount-index DB to check whether there are any blobs to inspect.
    // We deliberately do NOT use sqliteTableExists (which only sees the main DB).
    let handle: { db: DatabaseType; owned: boolean } | null = null;
    try {
      handle = openMountIndexDb();
      if (!handle) return false;
      const row = handle.db.prepare(
        `SELECT COUNT(*) AS n FROM "doc_mount_blobs"`,
      ).get() as { n: number } | undefined;
      return (row?.n ?? 0) > 0;
    } catch {
      return false;
    } finally {
      if (handle?.owned) {
        try { handle.db.close(); } catch { /* ignore */ }
      }
    }
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let handle: { db: DatabaseType; owned: boolean } | null = null;
    let scanned = 0;
    let corrected = 0;
    let skipped = 0;
    let orphaned = 0;
    let collidedWithExisting = 0;

    try {
      handle = openMountIndexDb();
      if (!handle) {
        return {
          id: MIGRATION_ID,
          success: true,
          itemsAffected: 0,
          message: 'No mount-index database present; nothing to reconcile',
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      // db is a narrowed non-nullable alias used throughout the loop so that
      // closures (e.g. db.transaction callbacks) do not see the nullable type.
      const db = handle.db;

      const total = (db.prepare(
        `SELECT COUNT(*) AS n FROM "doc_mount_blobs"`,
      ).get() as { n: number }).n;

      if (total === 0) {
        return {
          id: MIGRATION_ID,
          success: true,
          itemsAffected: 0,
          message: 'No doc_mount_blobs rows to reconcile',
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      logger.debug('Starting repair-mount-blob-sha256-from-bytes migration', {
        context: `migration.${MIGRATION_ID}`,
        total,
      });

      // Statements prepared once and reused across batches.
      const selectBatch = db.prepare(
        `SELECT id, fileId, sha256
           FROM "doc_mount_blobs"
          WHERE id > ?
          ORDER BY id
          LIMIT ?`,
      );

      const selectData = db.prepare(
        `SELECT data FROM "doc_mount_blobs" WHERE id = ?`,
      );

      const checkFileCollision = db.prepare(
        `SELECT COUNT(*) AS n
           FROM "doc_mount_files"
          WHERE sha256 = ? AND id != ?`,
      );

      const updateBlob = db.prepare(
        `UPDATE "doc_mount_blobs"
            SET sha256 = ?, updatedAt = ?
          WHERE id = ?`,
      );

      const updateFile = db.prepare(
        `UPDATE "doc_mount_files"
            SET sha256 = ?, updatedAt = ?
          WHERE id = ?`,
      );

      let lastId = '';
      while (true) {
        const batch = selectBatch.all(lastId, BATCH_SIZE) as BlobIdRow[];
        if (batch.length === 0) break;

        logger.debug('Processing blob batch', {
          context: `migration.${MIGRATION_ID}`,
          batchSize: batch.length,
          lastId,
        });

        for (const row of batch) {
          scanned++;

          // Fetch the BLOB data for this row individually — blobs can be
          // multi-MB, so we never SELECT data in the keyset-pagination query.
          const dataRow = selectData.get(row.id) as { data: Buffer | null } | undefined;
          const data = dataRow?.data;

          if (!data || data.length === 0) {
            orphaned++;
            logger.warn('doc_mount_blobs row has empty or null data; skipping sha256 repair', {
              context: `migration.${MIGRATION_ID}`,
              blobId: row.id,
              fileId: row.fileId,
            });
            reportProgress(scanned, total, 'blobs');
            continue;
          }

          const actual = sha256OfBuffer(data);

          if (actual === row.sha256) {
            skipped++;
            reportProgress(scanned, total, 'blobs');
            continue;
          }

          // Check whether any other doc_mount_files row already carries the
          // corrected sha — the index is not UNIQUE, so this is informational.
          const collision = checkFileCollision.get(actual, row.fileId) as { n: number };
          if (collision.n > 0) {
            collidedWithExisting++;
            logger.debug('Corrected sha256 already exists on another doc_mount_files row (non-fatal)', {
              context: `migration.${MIGRATION_ID}`,
              blobId: row.id,
              fileId: row.fileId,
              sha256WillBeSet: actual,
              collidingRowCount: collision.n,
            });
          }

          // Atomically update both the blob row and its paired file row.
          const now = new Date().toISOString();
          const tx = db.transaction(() => {
            updateBlob.run(actual, now, row.id);
            const fileChanges = updateFile.run(actual, now, row.fileId);
            if (fileChanges.changes === 0) {
              logger.warn('doc_mount_blobs.fileId has no matching doc_mount_files row; blob sha updated, file sha not updated', {
                context: `migration.${MIGRATION_ID}`,
                blobId: row.id,
                fileId: row.fileId,
              });
            }
          });
          tx();
          corrected++;

          logger.debug('Corrected sha256 on blob and file', {
            context: `migration.${MIGRATION_ID}`,
            blobId: row.id,
            fileId: row.fileId,
            oldSha256: row.sha256,
            newSha256: actual,
          });

          reportProgress(scanned, total, 'blobs');
        }

        lastId = batch[batch.length - 1].id;
      }

      const message =
        `Scanned ${scanned} blobs; corrected ${corrected}; skipped ${skipped} (already correct); ` +
        `${orphaned} orphaned (empty data); ${collidedWithExisting} corrections collided with existing file sha`;
      logger.info(message, {
        context: `migration.${MIGRATION_ID}`,
        scanned,
        corrected,
        skipped,
        orphaned,
        collidedWithExisting,
      });

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: corrected,
        message,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('repair-mount-blob-sha256-from-bytes migration aborted', {
        context: `migration.${MIGRATION_ID}`,
        error: errorMessage,
        scanned,
        corrected,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: corrected,
        message: 'repair-mount-blob-sha256-from-bytes migration aborted',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } finally {
      if (handle?.owned) {
        try { handle.db.close(); } catch { /* ignore */ }
      }
    }
  },
};
