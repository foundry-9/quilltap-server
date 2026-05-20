/**
 * Migration: Repair dangling `memories.relatedMemoryIds` edges (v1)
 *
 * `memories.relatedMemoryIds` is a JSON array column with no FK enforcement.
 * Until the `deleteMemoryWithUnlink` chokepoint landed, every code path that
 * removed a row from `memories` left the deleted ID dangling in every
 * neighbour's array. Friday's smoke test caught 9,390 such dangling edges.
 *
 * This migration is a one-time, idempotent scan that scrubs every dangling
 * ID from every `relatedMemoryIds` array. After it runs (and the chokepoint
 * is in place), `quilltap memories validate` should stay at zero forever.
 *
 * Migration ID: repair-dangling-related-memory-edges-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';

const MIGRATION_ID = 'repair-dangling-related-memory-edges-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;
const BATCH_SIZE = 500;

interface MemoryRow {
  id: string;
  relatedMemoryIds: string | null;
}

function needsWork(): boolean {
  if (!isSQLiteBackend()) return false;
  if (!sqliteTableExists('memories')) return false;
  const db = getSQLiteDatabase();
  // Cheap pre-check — bail if no row has any link entries to inspect.
  const row = db
    .prepare(
      `SELECT 1 AS x FROM memories
        WHERE relatedMemoryIds IS NOT NULL
          AND relatedMemoryIds NOT IN ('', '[]')
        LIMIT 1`,
    )
    .get() as { x: number } | undefined;
  return Boolean(row);
}

function parseLinks(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

function runMigration(): MigrationResult {
  const startTime = Date.now();
  let itemsAffected = 0;

  try {
    const db = getSQLiteDatabase();

    // Build the universe of valid memory IDs. Cross-character links are
    // legitimate — a memory's `relatedMemoryIds` may point at memories owned
    // by other holders — so the valid set is every row in the table, not
    // just the current holder's.
    const idRows = db.prepare('SELECT id FROM memories').all() as Array<{ id: string }>;
    const validIds = new Set<string>(idRows.map(r => r.id));

    logger.info('Loaded memory ID universe for dangling-edge repair', {
      context: LOG_CONTEXT,
      validMemoryCount: validIds.size,
    });

    const totalCandidatesRow = db
      .prepare(
        `SELECT COUNT(*) AS n FROM memories
         WHERE relatedMemoryIds IS NOT NULL
           AND relatedMemoryIds NOT IN ('', '[]')`,
      )
      .get() as { n: number } | undefined;
    const totalCandidates = totalCandidatesRow?.n ?? 0;

    const updateStmt = db.prepare(
      'UPDATE memories SET relatedMemoryIds = ? WHERE id = ?',
    );

    let totalScanned = 0;
    let rowsUpdated = 0;
    let edgesRemoved = 0;
    let lastId = '';

    while (true) {
      const batch = db
        .prepare(
          `SELECT id, relatedMemoryIds FROM memories
             WHERE relatedMemoryIds IS NOT NULL
               AND relatedMemoryIds NOT IN ('', '[]')
               AND id > ?
             ORDER BY id
             LIMIT ?`,
        )
        .all(lastId, BATCH_SIZE) as MemoryRow[];
      if (batch.length === 0) break;

      const tx = db.transaction((rows: MemoryRow[]) => {
        for (const row of rows) {
          totalScanned++;
          const current = parseLinks(row.relatedMemoryIds);
          if (current.length === 0) continue;
          const filtered = current.filter(id => validIds.has(id));
          if (filtered.length === current.length) continue;
          updateStmt.run(JSON.stringify(filtered), row.id);
          rowsUpdated++;
          edgesRemoved += current.length - filtered.length;
          itemsAffected++;
        }
      });
      tx(batch);

      reportProgress(totalScanned, totalCandidates, 'memories');
      lastId = batch[batch.length - 1].id;
    }

    const durationMs = Date.now() - startTime;
    logger.info('Dangling-edge repair complete', {
      context: LOG_CONTEXT,
      scanned: totalScanned,
      rowsUpdated,
      edgesRemoved,
      durationMs,
    });

    return {
      id: MIGRATION_ID,
      success: true,
      itemsAffected,
      message: `Removed ${edgesRemoved} dangling related-memory edge${edgesRemoved === 1 ? '' : 's'} from ${rowsUpdated} of ${totalScanned} scanned memories`,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Dangling-edge repair migration failed', {
      context: LOG_CONTEXT,
      error: errorMessage,
    });
    return {
      id: MIGRATION_ID,
      success: false,
      itemsAffected,
      message: `Migration failed: ${errorMessage}`,
      error: errorMessage,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

export const repairDanglingRelatedMemoryEdgesV1Migration: Migration = {
  id: MIGRATION_ID,
  description:
    'Scrub every `memories.relatedMemoryIds` JSON array of UUIDs that no longer resolve to a row in the `memories` table. Repairs the historical drift left by deletion paths that never had a symmetric unlink.',
  introducedInVersion: '4.5.0',

  async shouldRun(): Promise<boolean> {
    return needsWork();
  },

  async run(): Promise<MigrationResult> {
    logger.info('Starting dangling related-memory edge repair', { context: LOG_CONTEXT });
    return runMigration();
  },
};
