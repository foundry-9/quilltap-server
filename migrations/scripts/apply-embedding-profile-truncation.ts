/**
 * Migration: Apply Embedding Profile Truncation (Matryoshka)
 *
 * Slices and renormalises every stored vector BLOB whose dimension is an
 * integer multiple of the smallest active `truncateToDimensions` setting on
 * `embedding_profiles`. Mirrors the runtime `EMBEDDING_REAPPLY_PROFILE` job
 * (`lib/embedding/reapply-profile.ts`) but runs at startup so an instance
 * that flips a profile to a Matryoshka target gets its corpus aligned the
 * next time the server boots, without anyone having to push the manual
 * "Re-apply (Matryoshka)" button.
 *
 * Conservative scope: only touches rows whose stored dimension is a clean
 * integer multiple of the target (e.g. 4096 → 1024 at 4×). Non-multiple
 * dimensions (e.g. a stray 1536-d OpenAI text-embedding-3-small row in a
 * Qwen3-1024 corpus) are left alone, because slicing them would produce a
 * 1024-d vector in a different embedding space than the active profile —
 * mathematically valid but semantically wrong for cross-row similarity.
 * Those rows need re-embedding, not slicing, so the migration logs them and
 * leaves them for explicit cleanup.
 *
 * Tables walked (mirrors `normalize-embeddings-unit-vectors-v1`):
 *   - memories                 (main DB)
 *   - vector_entries           (main DB)
 *   - conversation_chunks      (main DB)
 *   - help_docs                (main DB)
 *   - doc_mount_chunks         (mount index DB)
 *
 * Safety:
 *   - `VACUUM INTO` backup of each affected DB before any writes.
 *   - Per-table rewrite runs in a single transaction.
 *   - VACUUM after writes to reclaim space.
 *
 * Migration ID: apply-embedding-profile-truncation-v1
 */
import fs from 'fs';
import path from 'path';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLitePath,
} from '../lib/database-utils';
import { getMountIndexDatabasePath } from '../../lib/paths';

const BYTES_PER_FLOAT = 4;
const FLUSH_BATCH = 500;
const ZERO_MAG = 1e-10;
const MAIN_DB_TABLES = [
  'memories',
  'vector_entries',
  'conversation_chunks',
  'help_docs',
] as const;

interface PerTableResult {
  table: string;
  truncated: number;
  alreadyAtTarget: number;
  shorterThanTarget: number;
  nonMultipleDimension: number;
  degenerate: number;
}

/**
 * Re-align `vector_indices.dimensions` for every character whose `vector_entries`
 * now contains at least one row at the target dim. Without this, the runtime
 * `CharacterVectorStore.load()` reads `meta.dimensions` (still 4096) and rejects
 * subsequent writes at the new target dim — re-creating the very mismatch the
 * truncation pass was supposed to clear.
 *
 * Characters with no target-dim entries (e.g. only 1536-d rows from a different
 * model that the conservative scope skipped) keep their existing metadata so
 * search continues to filter by the old dim until those rows are re-embedded.
 */
function realignVectorIndicesDimensions(
  db: DatabaseType,
  targetDim: number,
): number {
  if (
    !tableExistsIn(db, 'vector_indices') ||
    !tableExistsIn(db, 'vector_entries')
  ) {
    return 0;
  }
  const targetBytes = targetDim * BYTES_PER_FLOAT;
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `UPDATE vector_indices
        SET dimensions = ?, "updatedAt" = ?
      WHERE dimensions != ?
        AND "characterId" IN (
          SELECT DISTINCT "characterId" FROM vector_entries
          WHERE length(embedding) = ?
        )`,
  );
  const result = stmt.run(targetDim, now, targetDim, targetBytes);
  return Number(result.changes ?? 0);
}

interface ActiveTruncationProfile {
  id: string;
  truncateToDimensions: number;
  normalizeL2: boolean;
}

function blobToFloat32(buf: Buffer): Float32Array {
  const view = new Float32Array(
    buf.buffer,
    buf.byteOffset,
    buf.byteLength / BYTES_PER_FLOAT,
  );
  return new Float32Array(view);
}

function float32ToBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

function sliceAndNormalize(
  src: Float32Array,
  target: number,
  normalize: boolean,
): { dst: Float32Array; magnitude: number } {
  const dst = new Float32Array(target);
  let sumSq = 0;
  for (let i = 0; i < target; i++) {
    const v = src[i];
    dst[i] = v;
    sumSq += v * v;
  }
  const magnitude = Math.sqrt(sumSq);
  if (normalize && magnitude >= ZERO_MAG) {
    const inv = 1 / magnitude;
    for (let i = 0; i < target; i++) dst[i] *= inv;
  }
  return { dst, magnitude };
}

function tableExistsIn(db: DatabaseType, name: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
    .get(name) as { name: string } | undefined;
  return Boolean(row);
}

function openMountIndexDb(): DatabaseType | null {
  const dbPath = getMountIndexDatabasePath();
  if (!fs.existsSync(dbPath)) return null;
  const db = new Database(dbPath);
  try {
    const pepper = process.env.ENCRYPTION_MASTER_PEPPER;
    if (pepper) {
      const keyHex = Buffer.from(pepper, 'base64').toString('hex');
      db.pragma(`key = "x'${keyHex}'"`);
    }
    db.pragma('busy_timeout = 5000');
    return db;
  } catch (error) {
    try { db.close(); } catch { /* ignore */ }
    throw error;
  }
}

/**
 * Hot-copy a DB file via `VACUUM INTO`. The destination inherits the source's
 * encryption context, so SQLCipher backups stay encrypted.
 */
function vacuumIntoBackup(db: DatabaseType, srcPath: string): string {
  const dir = path.dirname(srcPath);
  const base = path.basename(srcPath, '.db');
  const stamp = new Date().toISOString().split('T')[0];
  const dst = path.join(dir, `${base}.bak-pre-matryoshka-${stamp}.db`);
  if (fs.existsSync(dst)) {
    const dstStamped = path.join(
      dir,
      `${base}.bak-pre-matryoshka-${stamp}-${Date.now()}.db`,
    );
    db.exec(`VACUUM INTO '${dstStamped.replace(/'/g, "''")}'`);
    return dstStamped;
  }
  db.exec(`VACUUM INTO '${dst.replace(/'/g, "''")}'`);
  return dst;
}

function findActiveTruncationProfile(): ActiveTruncationProfile | null {
  if (!sqliteTableExists('embedding_profiles')) return null;
  const db = getSQLiteDatabase();
  const row = db
    .prepare(
      `SELECT id, "truncateToDimensions" AS truncateToDimensions, COALESCE("normalizeL2", 1) AS normalizeL2
       FROM embedding_profiles
       WHERE "truncateToDimensions" IS NOT NULL AND "truncateToDimensions" > 0
       ORDER BY "truncateToDimensions" ASC
       LIMIT 1`,
    )
    .get() as
    | { id: string; truncateToDimensions: number; normalizeL2: number }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    truncateToDimensions: row.truncateToDimensions,
    normalizeL2: row.normalizeL2 !== 0,
  };
}

function tableHasSliceableRow(
  db: DatabaseType,
  table: string,
  targetBytes: number,
): boolean {
  if (!tableExistsIn(db, table)) return false;
  // Any row whose blob length is a multiple of targetBytes and strictly
  // larger than it is a slicing candidate.
  const row = db
    .prepare(
      `SELECT 1 FROM "${table}"
       WHERE embedding IS NOT NULL
         AND length(embedding) > ?
         AND length(embedding) % ? = 0
       LIMIT 1`,
    )
    .get(targetBytes, targetBytes);
  return Boolean(row);
}

function rewriteTable(
  db: DatabaseType,
  table: string,
  targetDim: number,
  normalize: boolean,
): PerTableResult {
  const targetBytes = targetDim * BYTES_PER_FLOAT;
  const result: PerTableResult = {
    table,
    truncated: 0,
    alreadyAtTarget: 0,
    shorterThanTarget: 0,
    nonMultipleDimension: 0,
    degenerate: 0,
  };

  const rows = db
    .prepare(`SELECT id, embedding FROM "${table}" WHERE embedding IS NOT NULL`)
    .all() as { id: string; embedding: Buffer | string | null }[];

  const update = db.prepare(`UPDATE "${table}" SET embedding = ? WHERE id = ?`);
  const writeMany = db.transaction(
    (items: { id: string; blob: Buffer }[]) => {
      for (const item of items) update.run(item.blob, item.id);
    },
  );

  const batch: { id: string; blob: Buffer }[] = [];
  for (const row of rows) {
    if (!row.embedding || typeof row.embedding === 'string') continue;
    const buf = row.embedding;
    if (buf.byteLength === targetBytes) {
      result.alreadyAtTarget++;
      continue;
    }
    if (buf.byteLength < targetBytes) {
      result.shorterThanTarget++;
      continue;
    }
    if (buf.byteLength % targetBytes !== 0) {
      // E.g. 1536-d row when target is 1024: a 1.5× ratio. Slicing is valid
      // for Matryoshka-trained models in general, but the resulting 1024-d
      // vector would live in a different embedding space than the active
      // profile's. Leave the row alone and let the operator re-embed it.
      result.nonMultipleDimension++;
      continue;
    }

    const src = blobToFloat32(buf);
    const { dst, magnitude } = sliceAndNormalize(src, targetDim, normalize);
    if (magnitude < ZERO_MAG) {
      result.degenerate++;
      continue;
    }

    batch.push({ id: row.id, blob: float32ToBlob(dst) });
    if (batch.length >= FLUSH_BATCH) {
      writeMany(batch);
      result.truncated += batch.length;
      batch.length = 0;
    }
  }
  if (batch.length > 0) {
    writeMany(batch);
    result.truncated += batch.length;
  }

  return result;
}

export const applyEmbeddingProfileTruncationMigration: Migration = {
  id: 'apply-embedding-profile-truncation-v1',
  description:
    'Slice + renormalise stored vectors to match the active embedding profile\'s truncateToDimensions (Matryoshka). Conservative: only touches rows whose stored dim is an integer multiple of the target.',
  introducedInVersion: '4.5.0',
  dependsOn: [
    'add-embedding-profile-truncation-fields-v1',
    'normalize-embeddings-unit-vectors-v1',
  ],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    const profile = findActiveTruncationProfile();
    if (!profile) return false;
    const targetBytes = profile.truncateToDimensions * BYTES_PER_FLOAT;
    const main = getSQLiteDatabase();
    for (const table of MAIN_DB_TABLES) {
      if (tableHasSliceableRow(main, table, targetBytes)) return true;
    }
    const mount = openMountIndexDb();
    if (mount) {
      try {
        if (tableHasSliceableRow(mount, 'doc_mount_chunks', targetBytes)) {
          return true;
        }
      } finally {
        try { mount.close(); } catch { /* ignore */ }
      }
    }
    return false;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    const perTable: PerTableResult[] = [];
    let backupPath: string | null = null;
    let mountBackupPath: string | null = null;

    try {
      const profile = findActiveTruncationProfile();
      if (!profile) {
        return {
          id: 'apply-embedding-profile-truncation-v1',
          success: true,
          itemsAffected: 0,
          message:
            'No embedding profile has truncateToDimensions set; nothing to do.',
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      const targetDim = profile.truncateToDimensions;
      const normalize = profile.normalizeL2;
      const main = getSQLiteDatabase();

      logger.info('Starting Matryoshka re-apply pass', {
        context: 'migration.apply-embedding-profile-truncation',
        profileId: profile.id,
        targetDim,
        normalize,
      });

      // Backup main DB before any writes.
      try {
        backupPath = vacuumIntoBackup(main, getSQLitePath());
        logger.info('Main DB backed up', {
          context: 'migration.apply-embedding-profile-truncation',
          backupPath,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('Main DB backup failed; aborting before any writes', {
          context: 'migration.apply-embedding-profile-truncation',
          error: msg,
        });
        return {
          id: 'apply-embedding-profile-truncation-v1',
          success: false,
          itemsAffected: 0,
          message: `Backup failed before any writes; aborted: ${msg}`,
          error: msg,
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      // Walk main DB tables.
      for (const table of MAIN_DB_TABLES) {
        if (!sqliteTableExists(table)) continue;
        const result = rewriteTable(main, table, targetDim, normalize);
        perTable.push(result);
        logger.info(`${table} pass complete`, {
          context: 'migration.apply-embedding-profile-truncation',
          ...result,
        });
      }

      // Re-align vector_indices.dimensions for characters whose vector_entries
      // now contain target-dim rows. Without this, CharacterVectorStore.load()
      // would still see the old dim in meta and reject new target-dim writes.
      const indicesUpdated = realignVectorIndicesDimensions(main, targetDim);
      if (indicesUpdated > 0) {
        logger.info('vector_indices dimensions re-aligned', {
          context: 'migration.apply-embedding-profile-truncation',
          rowsUpdated: indicesUpdated,
          targetDim,
        });
      }

      try { main.exec('VACUUM'); } catch (err) {
        logger.warn('Main DB VACUUM failed (non-fatal)', {
          context: 'migration.apply-embedding-profile-truncation',
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Walk mount index DB.
      const mount = openMountIndexDb();
      if (mount) {
        try {
          if (tableExistsIn(mount, 'doc_mount_chunks')) {
            try {
              mountBackupPath = vacuumIntoBackup(mount, getMountIndexDatabasePath());
              logger.info('Mount index DB backed up', {
                context: 'migration.apply-embedding-profile-truncation',
                mountBackupPath,
              });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              logger.error('Mount index backup failed; main DB rewrites already applied', {
                context: 'migration.apply-embedding-profile-truncation',
                error: msg,
              });
              const totalSoFar = perTable.reduce((s, r) => s + r.truncated, 0);
              return {
                id: 'apply-embedding-profile-truncation-v1',
                success: false,
                itemsAffected: totalSoFar,
                message: `Mount index backup failed: ${msg}. Main DB rewrites already applied.`,
                error: msg,
                durationMs: Date.now() - startTime,
                timestamp: new Date().toISOString(),
              };
            }

            const result = rewriteTable(
              mount,
              'doc_mount_chunks',
              targetDim,
              normalize,
            );
            perTable.push(result);
            logger.info('doc_mount_chunks pass complete', {
              context: 'migration.apply-embedding-profile-truncation',
              ...result,
            });

            try { mount.exec('VACUUM'); } catch (err) {
              logger.warn('Mount DB VACUUM failed (non-fatal)', {
                context: 'migration.apply-embedding-profile-truncation',
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        } finally {
          try { mount.close(); } catch { /* ignore */ }
        }
      }

      const totalTruncated = perTable.reduce((s, r) => s + r.truncated, 0);
      const totalNonMultiple = perTable.reduce(
        (s, r) => s + r.nonMultipleDimension,
        0,
      );
      const summary = perTable
        .map(
          (r) =>
            `${r.table}: ${r.truncated} sliced, ${r.alreadyAtTarget} kept, ${r.shorterThanTarget} too-short, ${r.nonMultipleDimension} non-multiple, ${r.degenerate} degenerate`,
        )
        .join('; ');

      if (totalNonMultiple > 0) {
        logger.warn(
          `${totalNonMultiple} row(s) had non-multiple dimensions and were left untouched. They likely came from a different embedding model and need re-embedding, not slicing.`,
          {
            context: 'migration.apply-embedding-profile-truncation',
            totalNonMultiple,
          },
        );
      }

      logger.info('Matryoshka re-apply migration completed', {
        context: 'migration.apply-embedding-profile-truncation',
        profileId: profile.id,
        targetDim,
        totalTruncated,
        totalNonMultiple,
        durationMs: Date.now() - startTime,
        backupPath,
        mountBackupPath,
      });

      const backupNote = mountBackupPath
        ? `Backups: ${backupPath}, ${mountBackupPath}.`
        : `Backup: ${backupPath}.`;
      const followupNote =
        totalNonMultiple > 0
          ? ` ${totalNonMultiple} row(s) at non-multiple dimensions were left alone — they need re-embedding via the active profile.`
          : '';

      return {
        id: 'apply-embedding-profile-truncation-v1',
        success: true,
        itemsAffected: totalTruncated,
        message: `Sliced ${totalTruncated} vector(s) to ${targetDim}-d using profile ${profile.id}. ${summary}. ${backupNote}${followupNote}`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Matryoshka re-apply migration failed', {
        context: 'migration.apply-embedding-profile-truncation',
        error: msg,
      });
      return {
        id: 'apply-embedding-profile-truncation-v1',
        success: false,
        itemsAffected: perTable.reduce((s, r) => s + r.truncated, 0),
        message: `Failed: ${msg}`,
        error: msg,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
