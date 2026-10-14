/**
 * Migration: retire the `vector_entries` / `vector_indices` mirror of memory
 * vectors (memory refactor Phase B, decision 1).
 *
 * A memory's vector was stored twice: on its own row (`memories.embedding`)
 * and again in `vector_entries`, with per-character metadata in
 * `vector_indices`. The mirror had no foreign key, so a delete that forgot it
 * left an orphan vector that blinded the memory gate (bug 200), and a tier
 * move it never saw left cold rows in hot-only recall (bug 205). From Phase B
 * the row is the only copy: the in-process index loads `id, embedding, tier`
 * from `memories` and `memoryIndex` writes nothing else.
 *
 * Before dropping the mirror this walks every `vector_entries` row and, where
 * its memory exists and has no embedding of its own, copies the mirror's
 * vector onto the row — the mirror should never have held a vector the row
 * lacked, but it costs one pass to be sure. A JSON-text vector (a
 * development hot-reload artefact) is converted to the stored BLOB format on
 * the way. Then both tables are dropped.
 *
 * Paged by rowid, so a large corpus is never materialized and a row that
 * cannot be copied cannot stall the walk.
 *
 * Migration ID: retire-memory-vector-entries-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import { isSQLiteBackend, getSQLiteDatabase, sqliteTableExists } from '../lib/database-utils';
import { float32ToBlob, parseLegacyEmbeddingText } from '@/lib/embedding/float32-conversion';

const MIGRATION_ID = 'retire-memory-vector-entries-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;
const PAGE_SIZE = 500;

interface MirrorRow {
  rid: number | bigint;
  id: string;
  embedding: Buffer | string | null;
}

/** The mirror's vector as a stored embedding BLOB, or null when it has none usable. */
function mirrorBlob(value: Buffer | string | null): Buffer | null {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return value.length > 0 ? value : null;
  if (typeof value === 'string') {
    const parsed = parseLegacyEmbeddingText(value);
    return parsed && parsed.length > 0 ? float32ToBlob(parsed) : null;
  }
  return null;
}

export const retireMemoryVectorEntriesMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Copy any memory vector held only by vector_entries onto its memory row, then drop vector_entries and vector_indices',
  introducedInVersion: '4.10.0',
  // Every earlier migration that reads or rewrites the mirror runs first.
  dependsOn: [
    'sqlite-initial-schema-v1',
    'normalize-vector-storage-v1',
    'fix-text-embeddings-after-update-v1',
    'normalize-embeddings-unit-vectors-v1',
    'apply-embedding-profile-truncation-v1',
    'quantize-embeddings-v1',
  ],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    return sqliteTableExists('vector_entries') || sqliteTableExists('vector_indices');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let copied = 0;
    let alreadyOnRow = 0;
    let orphaned = 0;
    let unusable = 0;
    let dropped = 0;

    try {
      const db = getSQLiteDatabase();

      if (sqliteTableExists('vector_entries') && sqliteTableExists('memories')) {
        const total = Number(
          (db.prepare(`SELECT COUNT(*) AS n FROM vector_entries`).get() as { n: number | bigint }).n,
        );
        logger.info('Verifying memory vectors against their rows before retiring the mirror', {
          context: LOG_CONTEXT,
          mirrorRows: total,
        });

        const page = db.prepare(
          `SELECT rowid AS rid, id, embedding FROM vector_entries WHERE rowid > ? ORDER BY rowid LIMIT ?`,
        );
        const rowState = db.prepare(`SELECT embedding IS NOT NULL AS has FROM memories WHERE id = ?`);
        const copy = db.prepare(`UPDATE memories SET embedding = ? WHERE id = ? AND embedding IS NULL`);
        const copyPage = db.transaction((rows: MirrorRow[]) => {
          for (const row of rows) {
            const state = rowState.get(row.id) as { has: number } | undefined;
            if (!state) {
              orphaned++;
              continue;
            }
            if (state.has) {
              alreadyOnRow++;
              continue;
            }
            const blob = mirrorBlob(row.embedding);
            if (!blob) {
              unusable++;
              continue;
            }
            copied += copy.run(blob, row.id).changes;
          }
        });

        let cursor: number | bigint = 0;
        let seen = 0;
        for (;;) {
          const rows = page.all(cursor, PAGE_SIZE) as MirrorRow[];
          if (rows.length === 0) break;
          copyPage(rows);
          cursor = rows[rows.length - 1].rid;
          seen += rows.length;
          reportProgress(seen, total, 'memory vectors');
        }
      }

      for (const table of ['vector_entries', 'vector_indices']) {
        if (sqliteTableExists(table)) {
          db.exec(`DROP TABLE IF EXISTS "${table}"`);
          dropped++;
        }
      }

      logger.info('Retired the memory vector mirror', {
        context: LOG_CONTEXT,
        copied,
        alreadyOnRow,
        orphaned,
        unusable,
        tablesDropped: dropped,
      });

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: copied + dropped,
        message: `Memory vectors now live on their rows only (${copied} copied from the mirror, ${orphaned} orphan mirror rows discarded, ${dropped} tables dropped)`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Retiring the memory vector mirror failed', {
        context: LOG_CONTEXT,
        error: errorMessage,
        copied,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: copied,
        message: `Retiring the memory vector mirror failed: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
