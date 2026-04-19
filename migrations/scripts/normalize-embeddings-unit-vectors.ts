/**
 * Migration: Normalize Embeddings to Unit Vectors
 *
 * All vector embeddings stored in the app are now L2-normalised to unit
 * length so cosine similarity reduces to a single dot product. This
 * migration walks every embedding BLOB across the main DB (memories,
 * vector_entries, conversation_chunks, help_docs) and the mount index DB
 * (doc_mount_chunks), normalising each vector in place.
 *
 * Idempotent: re-normalising a unit vector is a no-op within float
 * tolerance; the migration skips vectors already within 1e-4 of unit
 * length.
 *
 * Migration ID: normalize-embeddings-unit-vectors-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'fs';
import { getMountIndexDatabasePath } from '../../lib/paths';

const UNIT_TOLERANCE = 1e-4;
const SAMPLE_SIZE = 100;
const MAIN_DB_TABLES = ['memories', 'vector_entries', 'conversation_chunks', 'help_docs'];

function blobToFloat32(blob: Buffer): Float32Array {
  const view = new Float32Array(
    blob.buffer,
    blob.byteOffset,
    blob.byteLength / Float32Array.BYTES_PER_ELEMENT
  );
  return new Float32Array(view);
}

function float32ToBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

function normInPlace(v: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const n = Math.sqrt(sum);
  if (n === 0) return 0;
  const inv = 1 / n;
  for (let i = 0; i < v.length; i++) v[i] = v[i] * inv;
  return n;
}

function isNearUnit(v: Float32Array): boolean {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  return Math.abs(Math.sqrt(sum) - 1) < UNIT_TOLERANCE;
}

/**
 * Open the mount index DB directly using the same pepper as the main DB.
 * Returns null if the DB file doesn't exist (no mount chunks to normalise).
 */
function openMountIndexDb(): DatabaseType | null {
  const dbPath = getMountIndexDatabasePath();
  if (!fs.existsSync(dbPath)) {
    return null;
  }
  const db = new Database(dbPath);
  try {
    const pepper = process.env.ENCRYPTION_MASTER_PEPPER;
    if (pepper) {
      const keyHex = Buffer.from(pepper, 'base64').toString('hex');
      db.pragma(`key = "x'${keyHex}'"`);
    }
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    return db;
  } catch (error) {
    try { db.close(); } catch { /* ignore */ }
    throw error;
  }
}

function tableHasUnnormalisedEmbeddings(db: DatabaseType, table: string): boolean {
  try {
    const rows = db.prepare(
      `SELECT embedding FROM "${table}" WHERE embedding IS NOT NULL LIMIT ${SAMPLE_SIZE}`
    ).all() as { embedding: Buffer | string | null }[];
    for (const row of rows) {
      if (!row.embedding || typeof row.embedding === 'string') continue;
      const v = blobToFloat32(row.embedding);
      if (v.length === 0) continue;
      if (!isNearUnit(v)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function normaliseTable(db: DatabaseType, table: string): number {
  const rows = db.prepare(
    `SELECT id, embedding FROM "${table}" WHERE embedding IS NOT NULL`
  ).all() as { id: string; embedding: Buffer | string | null }[];

  const update = db.prepare(
    `UPDATE "${table}" SET embedding = ? WHERE id = ?`
  );

  let affected = 0;
  const writeMany = db.transaction((items: { id: string; blob: Buffer }[]) => {
    for (const item of items) update.run(item.blob, item.id);
  });

  const batch: { id: string; blob: Buffer }[] = [];
  const FLUSH = 500;

  for (const row of rows) {
    if (!row.embedding || typeof row.embedding === 'string') continue;
    const v = blobToFloat32(row.embedding);
    if (v.length === 0) continue;
    if (isNearUnit(v)) continue;
    normInPlace(v);
    batch.push({ id: row.id, blob: float32ToBlob(v) });
    if (batch.length >= FLUSH) {
      writeMany(batch);
      affected += batch.length;
      batch.length = 0;
    }
  }
  if (batch.length > 0) {
    writeMany(batch);
    affected += batch.length;
  }

  return affected;
}

export const normalizeEmbeddingsUnitVectorsMigration: Migration = {
  id: 'normalize-embeddings-unit-vectors-v1',
  description: 'Normalise all stored embeddings to unit length for fast cosine similarity',
  introducedInVersion: '3.3.0',
  dependsOn: ['fix-text-embeddings-after-update-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;

    const main = getSQLiteDatabase();
    for (const table of MAIN_DB_TABLES) {
      if (sqliteTableExists(table) && tableHasUnnormalisedEmbeddings(main, table)) {
        return true;
      }
    }

    const mount = openMountIndexDb();
    if (mount) {
      try {
        const stmt = mount.prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='doc_mount_chunks'`
        ).get() as { name: string } | undefined;
        if (stmt && tableHasUnnormalisedEmbeddings(mount, 'doc_mount_chunks')) {
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
    const counts: Record<string, number> = {};

    try {
      const main = getSQLiteDatabase();
      for (const table of MAIN_DB_TABLES) {
        if (!sqliteTableExists(table)) continue;
        const affected = normaliseTable(main, table);
        counts[table] = affected;
        if (affected > 0) {
          logger.info(`Normalised ${affected} embeddings in ${table}`, {
            context: 'normalize-embeddings-unit-vectors-v1',
            table,
            affected,
          });
        }
      }

      const mount = openMountIndexDb();
      if (mount) {
        try {
          const tableExists = mount.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='doc_mount_chunks'`
          ).get();
          if (tableExists) {
            const affected = normaliseTable(mount, 'doc_mount_chunks');
            counts['doc_mount_chunks'] = affected;
            if (affected > 0) {
              logger.info(`Normalised ${affected} embeddings in doc_mount_chunks`, {
                context: 'normalize-embeddings-unit-vectors-v1',
                table: 'doc_mount_chunks',
                affected,
              });
            }
          }
        } finally {
          try { mount.close(); } catch { /* ignore */ }
        }
      }

      const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
      const perTable = Object.entries(counts)
        .filter(([, n]) => n > 0)
        .map(([t, n]) => `${t}: ${n}`)
        .join(', ') || 'nothing to normalise';

      return {
        id: 'normalize-embeddings-unit-vectors-v1',
        success: true,
        itemsAffected: total,
        message: `Normalised embeddings to unit vectors — ${perTable}`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to normalise embeddings', {
        context: 'normalize-embeddings-unit-vectors-v1',
        error: message,
      });
      return {
        id: 'normalize-embeddings-unit-vectors-v1',
        success: false,
        error: message,
        itemsAffected: 0,
        message: `Normalisation failed: ${message}`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
