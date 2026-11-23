/**
 * Migration: Realign `files.sha256` with the bytes actually stored
 *
 * `lib/chat-files-v2.ts` hashed the *input* buffer and let the storage bridge
 * transcode afterwards, so a chat upload that arrived as PNG or JPEG was
 * stored as WebP under a row whose `sha256` named bytes that exist nowhere.
 * The sibling path `lib/images-v2.ts` transcodes first and hashes second,
 * which is why every generated image joined cleanly and half the uploads did
 * not — in the instance that surfaced this, 118 of 239 uploaded images, all of
 * them converted WebP.
 *
 * Nothing was corrupted; the joins simply stopped meeting. `files.sha256` was
 * speaking input-hash and the mount index was speaking stored-hash, so every
 * cross-domain lookup returned an empty result that its caller read as "no
 * such file" and logged at `info`:
 *
 *   - `lib/photos/auto-describe-attachment.ts` — a generated description never
 *     reached `doc_mount_file_links.description`/`extractedText`, so it was
 *     never chunked or embedded and the image was unsearchable (`linksUpdated: 0`)
 *   - `lib/tools/handlers/doc-edit/photo-handlers.ts` — `describe_image` and
 *     `attach_image` could not resolve a mount-link uuid to its FileEntry
 *   - `lib/photos/save-image-to-album.ts` — `keep_image` from a mount link
 *     could not find its sister FileEntry
 *   - `lib/photos/photo-link-summary.ts` — link summaries reported zero linkers
 *
 * See bug 117. The forward fix runs the bridge's own `transcodeToWebP` before
 * anything is hashed, so one hash serves both dedup and the join; this
 * migration repairs the rows written before that.
 *
 * It walks every `files` row whose `storageKey` is a `mount-blob:` key, reads
 * the blob's own hash out of the mount-index database, and writes it to
 * `files.sha256` where the two disagree. No bytes are touched and no blob is
 * re-hashed — `doc_mount_blobs.sha256` is recomputed from the actual bytes at
 * write time (`linkBlobContent`) and repaired by
 * `repair-mount-blob-sha256-from-bytes-v1`, so it is already the trustworthy
 * side of the join.
 *
 * Note that `repair-files-mime-and-size-from-mount-blob-v1` deliberately left
 * `sha256` alone, on the grounds that it was load-bearing for upload dedup.
 * That was true at the time and is no longer: dedup now compares stored-bytes
 * hashes on both sides, so this column can mean one thing.
 *
 * Idempotent: rows already in agreement are skipped, and a row whose blob has
 * gone missing is logged and left as it is rather than guessed at.
 *
 * ## v2
 *
 * The same drift came back on the generated-image paths. `createGeneratedFileRow`
 * took its `sha256` as a separate input, and the wardrobe-avatar job, the
 * story-background job and the wardrobe preview passed the provider's raw-bytes
 * hash while `size` and `mimeType` came from the bridge's stored result. Every
 * picture the bridge re-encoded got a row hashing bytes that exist nowhere —
 * on the reference instance 546 of 3,831 mount-blob images, most since
 * September. The stale-chat asset sweep matched a kept character avatar by
 * that hash, found no vault links, and deleted a default avatar. The forward
 * fix makes the hash part of `StoredImageBytes`, so the row can only take the
 * stored one; v2 is the same pass, run again, for the rows written before it.
 *
 * Migration IDs: realign-file-entry-sha256-v1, -v2
 */

import type { Database as DatabaseType } from 'better-sqlite3';
import fs from 'fs';
import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  openMountIndexDbIfPresent,
} from '../lib/database-utils';
import { getMountIndexDatabasePath } from '../../lib/paths';

const STORAGE_KEY_PREFIX = 'mount-blob:';
const BATCH_SIZE = 500;

/** `mount-blob:<mountPointId>:<blobId>` → `<blobId>`. */
function parseBlobId(storageKey: string): string | null {
  if (!storageKey.startsWith(STORAGE_KEY_PREFIX)) return null;
  const rest = storageKey.slice(STORAGE_KEY_PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep < 1 || sep === rest.length - 1) return null;
  return rest.slice(sep + 1);
}

interface FileRow {
  id: string;
  sha256: string;
  storageKey: string;
}

interface BlobRow {
  sha256: string;
}

interface RealignMigrationSpec {
  id: string;
  description: string;
  introducedInVersion: string;
  dependsOn: string[];
}

/**
 * Build one run of the realign pass. v1 and v2 differ only in identity and
 * ordering, so they share this body rather than copying it.
 */
function createRealignFileEntrySha256Migration(spec: RealignMigrationSpec): Migration {
  const MIGRATION_ID = spec.id;
  return {
    id: MIGRATION_ID,
    description: spec.description,
    introducedInVersion: spec.introducedInVersion,
    dependsOn: spec.dependsOn,

    async shouldRun(): Promise<boolean> {
      if (!isSQLiteBackend()) return false;
      if (!sqliteTableExists('files')) return false;
      if (!fs.existsSync(getMountIndexDatabasePath())) return false;

      const db = getSQLiteDatabase();
      const row = db.prepare(
        `SELECT COUNT(*) AS n
           FROM "files"
          WHERE storageKey LIKE 'mount-blob:%'`,
      ).get() as { n: number };
      return row.n > 0;
    },

    async run(): Promise<MigrationResult> {
      const startTime = Date.now();
      let mountDb: DatabaseType | null = null;
      let scanned = 0;
      let realigned = 0;
      let orphaned = 0;
      let malformedKey = 0;

      try {
        mountDb = openMountIndexDbIfPresent({ foreignKeys: true });
        if (!mountDb) {
          return {
            id: MIGRATION_ID,
            success: true,
            itemsAffected: 0,
            message: 'No mount-index database present; nothing to realign',
            durationMs: Date.now() - startTime,
            timestamp: new Date().toISOString(),
          };
        }

        const mainDb = getSQLiteDatabase();

        const total = (mainDb.prepare(
          `SELECT COUNT(*) AS n FROM "files" WHERE storageKey LIKE 'mount-blob:%'`,
        ).get() as { n: number }).n;

        if (total === 0) {
          return {
            id: MIGRATION_ID,
            success: true,
            itemsAffected: 0,
            message: 'No mount-blob FileEntries to realign',
            durationMs: Date.now() - startTime,
            timestamp: new Date().toISOString(),
          };
        }

        const selectBatch = mainDb.prepare(
          `SELECT id, sha256, storageKey
             FROM "files"
            WHERE storageKey LIKE 'mount-blob:%'
              AND id > ?
            ORDER BY id
            LIMIT ?`,
        );

        const findBlob = mountDb.prepare(
          `SELECT sha256 FROM "doc_mount_blobs" WHERE id = ?`,
        );

        const updateFile = mainDb.prepare(
          `UPDATE "files" SET sha256 = ?, updatedAt = ? WHERE id = ?`,
        );

        let lastId = '';
        for (;;) {
          const batch = selectBatch.all(lastId, BATCH_SIZE) as FileRow[];
          if (batch.length === 0) break;

          // Read the blob hashes up-front, apply the writes in one transaction
          // afterwards: a row whose blob has vanished must not abort the batch
          // around it.
          const updates: Array<{ id: string; sha256: string }> = [];
          for (const row of batch) {
            scanned++;
            // Per row, not per batch: `reportProgress` throttles itself to
            // ~250 ms, and a library larger than one batch should not leave the
            // loading screen still for 500 rows at a time.
            reportProgress(scanned, total, 'files');
            const blobId = parseBlobId(row.storageKey);
            if (!blobId) {
              malformedKey++;
              logger.warn('Malformed mount-blob storage key; sha256 left untouched', {
                context: `migration.${MIGRATION_ID}`,
                fileId: row.id,
                storageKey: row.storageKey,
              });
              continue;
            }
            const blob = findBlob.get(blobId) as BlobRow | undefined;
            if (!blob) {
              orphaned++;
              logger.warn('Mount blob missing for FileEntry; sha256 left untouched', {
                context: `migration.${MIGRATION_ID}`,
                fileId: row.id,
                blobId,
              });
              continue;
            }
            if (blob.sha256 === row.sha256) continue;
            updates.push({ id: row.id, sha256: blob.sha256 });
          }

          if (updates.length > 0) {
            const now = new Date().toISOString();
            const tx = mainDb.transaction((rows: typeof updates) => {
              for (const u of rows) {
                updateFile.run(u.sha256, now, u.id);
                realigned++;
              }
            });
            tx(updates);
          }

          lastId = batch[batch.length - 1].id;
        }

        const message = `Scanned ${scanned} mount-blob FileEntries; realigned ${realigned} sha256 values; ${orphaned} orphaned (no matching blob), ${malformedKey} malformed storage keys`;
        logger.info(message, {
          context: `migration.${MIGRATION_ID}`,
          scanned,
          realigned,
          orphaned,
          malformedKey,
        });

        return {
          id: MIGRATION_ID,
          success: true,
          itemsAffected: realigned,
          message,
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Realign-file-entry-sha256 migration aborted', {
          context: `migration.${MIGRATION_ID}`,
          error: errorMessage,
          scanned,
          realigned,
        });
        return {
          id: MIGRATION_ID,
          success: false,
          itemsAffected: realigned,
          message: 'Realign-file-entry-sha256 migration aborted',
          error: errorMessage,
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      } finally {
        if (mountDb) {
          try { mountDb.close(); } catch { /* ignore */ }
        }
      }
    },
  };
}

export const realignFileEntrySha256Migration = createRealignFileEntrySha256Migration({
  id: 'realign-file-entry-sha256-v1',
  description:
    'Rewrite files.sha256 to the hash of the bytes actually stored, so FileEntries join to the mount blobs they point at',
  introducedInVersion: '4.9.0',
  dependsOn: [
    'relink-files-to-mount-blobs-v1',
    'repair-mount-blob-sha256-from-bytes-v1',
  ],
});

export const realignFileEntrySha256V2Migration = createRealignFileEntrySha256Migration({
  id: 'realign-file-entry-sha256-v2',
  description:
    'Rewrite files.sha256 to the stored-bytes hash again, for generated images whose rows took the provider\'s raw-bytes hash',
  introducedInVersion: '4.14.0',
  dependsOn: ['realign-file-entry-sha256-v1'],
});
