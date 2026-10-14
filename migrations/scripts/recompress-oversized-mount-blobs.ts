/**
 * Migration: Re-encode oversized image blobs in the Scriptorium store
 *
 * Two classes of image reached `doc_mount_blobs` in a form far larger than the
 * store's own policy intends, because transcoding used to be an optional
 * courtesy at each call site rather than a chokepoint:
 *
 *  - **Untranscoded bitmaps** (PNG/JPEG/GIF/TIFF/…). Most arrived in a single
 *    batch from the filesystem→DB cutover (`lib/mount-index/conversion.ts`
 *    bypassed the transcoder deliberately so "original bytes survive"); the
 *    rest trickled in through the photo-gallery services. On the reference
 *    instance: 68 PNGs totalling 96.5 MB, including three personified-feature
 *    avatars at ~6.7 MB each where the shipped asset is ~50 KB.
 *  - **Lossless WebP** (`VP8L`). `image/webp` was excluded from transcoding
 *    wholesale, which is right for lossy WebP and wrong for lossless: 71 files
 *    totalling 112 MB, averaging 1.6 MB at 1536×1024.
 *
 * Measured re-encoded at quality 85: PNGs land at ~7% of their stored size,
 * lossless WebP at ~15%. Roughly 185 MB on the reference instance.
 *
 * The write-side cause is fixed separately and permanently in
 * `lib/mount-index/normalize-blob-image.ts`, which `linkBlobContent` now calls
 * on every write. This migration only cleans up what landed before that.
 *
 * ## What this deliberately does NOT do
 *
 * **Paths and file names are left exactly as they are**, even when a `.png`
 * now holds WebP bytes. New writes rename (nothing references them yet), but
 * an existing blob is referenced by stored Markdown as
 * `.../blobs/<relativePath>`, and renaming would break every one of those
 * links. The serving routes set `Content-Type` from `storedMimeType`, not from
 * the extension, so a renamed-in-place blob is served correctly — the
 * extension becomes cosmetically wrong and nothing else.
 *
 * **Lossy WebP is never re-encoded.** Lossy→lossy is generation loss for a
 * modest saving.
 *
 * ## Hashes
 *
 * Re-encoding changes the bytes, so `sha256` changes. Three places record it
 * and all three are updated in one transaction per blob:
 *   - `doc_mount_blobs`   — `data`, `sha256`, `sizeBytes`, `storedMimeType`
 *   - `doc_mount_files`   — `sha256`, `fileSizeBytes`
 *   - `files` (MAIN db)   — `sha256`, joined on the OLD hash (bug 117's
 *                           invariant: `files.sha256 == doc_mount_files.sha256`)
 *
 * A hard-link group shares one `fileId` and therefore one blob row, so every
 * sibling link picks up the smaller image from a single re-encode — which is
 * the intent, since it is the same picture.
 *
 * Browsers may hold the old bytes: `/api/v1/files/proxy/...` is served
 * `immutable, max-age=31536000` under a blobId-keyed URL that does not change.
 * The cached copy is the same picture at a larger size, so the staleness is
 * cosmetic and self-heals.
 *
 * ONE-WAY: the original bytes are discarded. Take a physical backup before
 * upgrading across this migration.
 *
 * Rewriting rows only frees pages inside the file — run
 * `npx quilltap db optimize` afterwards to shrink it.
 *
 * Migration ID: recompress-oversized-mount-blobs-v1
 */

import type { Database as DatabaseType } from 'better-sqlite3';
import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  openMountIndexDbIfPresent,
  tableExists,
} from '../lib/database-utils';
import {
  transcodeToWebP,
  isLosslessWebP,
  LOSSLESS_WEBP_REENCODE_MIN_BYTES,
} from '@/lib/mount-index/blob-transcode';

/** Bitmap types the transcoder will convert. Mirrors TRANSCODABLE_MIME_TYPES. */
const BITMAP_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/tiff',
  'image/avif',
];

const MIME_PLACEHOLDERS = BITMAP_MIME_TYPES.map(() => '?').join(',');

/**
 * Candidate rows: every bitmap, plus every WebP big enough to be worth
 * sniffing. The lossless check needs the bytes, so it happens per row.
 */
const CANDIDATE_SQL = `
  SELECT id, fileId, sha256, sizeBytes, storedMimeType
    FROM doc_mount_blobs
   WHERE lower(storedMimeType) IN (${MIME_PLACEHOLDERS})
      OR (lower(storedMimeType) = 'image/webp' AND length(data) >= ?)
   ORDER BY rowid
`;

/**
 * `shouldRun` sniffs at most this many large WebP rows. Losslessness cannot be
 * decided in SQL — it needs the RIFF chunk walk — so the probe is bounded.
 * This is only a re-entry heuristic: the migration-state table is what
 * actually prevents a second run.
 */
const SAMPLE_LIMIT = 64;

interface CandidateRow {
  id: string;
  fileId: string;
  sha256: string;
  sizeBytes: number;
  storedMimeType: string;
}

/** Re-encode one blob, or report why it was left alone. */
async function recompressOne(
  mountDb: DatabaseType,
  mainDb: DatabaseType | null,
  row: CandidateRow,
): Promise<{ saved: number; skipped: boolean }> {
  const dataRow = mountDb
    .prepare('SELECT data FROM doc_mount_blobs WHERE id = ?')
    .get(row.id) as { data: Buffer } | undefined;
  if (!dataRow?.data) return { saved: 0, skipped: true };

  const original = dataRow.data;
  const isWebP = row.storedMimeType.toLowerCase() === 'image/webp';

  // A lossy WebP is never re-encoded; a small lossless one is not worth it.
  if (isWebP && !(original.length >= LOSSLESS_WEBP_REENCODE_MIN_BYTES && isLosslessWebP(original))) {
    return { saved: 0, skipped: true };
  }

  const out = await transcodeToWebP(original, row.storedMimeType);

  // transcodeToWebP hands the original bytes back when sharp fails or when it
  // declines — and a re-encode that grew is not worth taking.
  if (out.data === original || out.sizeBytes >= original.length) {
    return { saved: 0, skipped: true };
  }

  const apply = mountDb.transaction(() => {
    mountDb
      .prepare(
        `UPDATE doc_mount_blobs
            SET data = ?, sha256 = ?, sizeBytes = ?, storedMimeType = ?, updatedAt = ?
          WHERE id = ?`,
      )
      .run(out.data, out.sha256, out.sizeBytes, out.storedMimeType, new Date().toISOString(), row.id);

    mountDb
      .prepare(
        `UPDATE doc_mount_files
            SET sha256 = ?, fileSizeBytes = ?, updatedAt = ?
          WHERE id = ?`,
      )
      .run(out.sha256, out.sizeBytes, new Date().toISOString(), row.fileId);
  });
  apply();

  // Keep the cross-database invariant files.sha256 == doc_mount_files.sha256
  // (bug 117). Joined on the OLD hash, so a files row that was already adrift
  // is simply not matched rather than being wrongly claimed.
  if (mainDb) {
    try {
      const res = mainDb
        .prepare('UPDATE files SET sha256 = ? WHERE sha256 = ?')
        .run(out.sha256, row.sha256);
      if (res.changes > 0) {
        logger.debug('Realigned files.sha256 after blob re-encode', {
          context: 'migrations.recompress-oversized-mount-blobs',
          blobId: row.id,
          filesRowsUpdated: res.changes,
        });
      }
    } catch (error) {
      // A missing/odd `files` table must not abort the size reclamation.
      logger.warn('Could not realign files.sha256 — continuing', {
        context: 'migrations.recompress-oversized-mount-blobs',
        blobId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { saved: original.length - out.sizeBytes, skipped: false };
}

const MIGRATION_ID = 'recompress-oversized-mount-blobs-v1';

export const recompressOversizedMountBlobsMigration: Migration = {
  id: MIGRATION_ID,
  description:
    'Re-encode untranscoded bitmaps and oversized lossless WebP in doc_mount_blobs to lossy WebP',
  introducedInVersion: '4.10.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    const db = openMountIndexDbIfPresent();
    if (!db) return false;
    try {
      if (!tableExists(db, 'doc_mount_blobs')) return false;

      // Any untranscoded bitmap is work, and SQL can say so outright.
      const bitmap = db
        .prepare(
          `SELECT 1 FROM doc_mount_blobs
            WHERE lower(storedMimeType) IN (${MIME_PLACEHOLDERS}) LIMIT 1`,
        )
        .get(...BITMAP_MIME_TYPES);
      if (bitmap) return true;

      // A large WebP is only work when it is LOSSLESS, which needs the bytes.
      // Without this check the migration would report work forever, because
      // large *lossy* WebP is exactly what it is supposed to leave behind.
      const webpRows = db
        .prepare(
          `SELECT data FROM doc_mount_blobs
            WHERE lower(storedMimeType) = 'image/webp' AND length(data) >= ?
            LIMIT ${SAMPLE_LIMIT}`,
        )
        .all(LOSSLESS_WEBP_REENCODE_MIN_BYTES) as { data: Buffer }[];
      return webpRows.some((r) => r.data && isLosslessWebP(r.data));
    } finally {
      db.close();
    }
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    const mountDb = openMountIndexDbIfPresent();
    if (!mountDb) {
      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: 0,
        message: 'No mount-index database — nothing to re-encode',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    let mainDb: DatabaseType | null = null;
    try {
      mainDb = getSQLiteDatabase();
    } catch {
      mainDb = null;
    }

    let recompressed = 0;
    let skipped = 0;
    let failed = 0;
    let bytesSaved = 0;

    try {
      const candidates = mountDb
        .prepare(CANDIDATE_SQL)
        .all(...BITMAP_MIME_TYPES, LOSSLESS_WEBP_REENCODE_MIN_BYTES) as CandidateRow[];

      logger.info('Re-encoding oversized mount blobs', {
        context: 'migrations.recompress-oversized-mount-blobs',
        candidates: candidates.length,
      });

      for (let i = 0; i < candidates.length; i++) {
        const row = candidates[i];
        try {
          const { saved, skipped: wasSkipped } = await recompressOne(mountDb, mainDb, row);
          if (wasSkipped) {
            skipped++;
          } else {
            recompressed++;
            bytesSaved += saved;
          }
        } catch (error) {
          // One unreadable image must never abort the whole pass.
          failed++;
          logger.warn('Failed to re-encode blob — leaving it as-is', {
            context: 'migrations.recompress-oversized-mount-blobs',
            blobId: row.id,
            storedMimeType: row.storedMimeType,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        reportProgress(i + 1, candidates.length, 'images');
      }
    } finally {
      mountDb.close();
    }

    const savedMb = (bytesSaved / 1048576).toFixed(1);
    logger.info('Oversized mount blob re-encode complete', {
      context: 'migrations.recompress-oversized-mount-blobs',
      recompressed,
      skipped,
      failed,
      bytesSaved,
    });

    return {
      id: MIGRATION_ID,
      success: true,
      itemsAffected: recompressed,
      message:
        recompressed > 0
          ? `Re-encoded ${recompressed} image${recompressed === 1 ? '' : 's'}, reclaiming ${savedMb} MB ` +
            `(${skipped} left as-is, ${failed} failed). Run 'npx quilltap db optimize' to shrink the file.`
          : `No image needed re-encoding (${skipped} left as-is, ${failed} failed)`,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  },
};
