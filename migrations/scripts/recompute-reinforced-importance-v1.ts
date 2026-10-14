/**
 * Migration: Recompute every memory's reinforced importance.
 *
 * Bug 216 / locked decision 6 of the memory system refactor. The formula was
 * `min(1, importance + log2(count + 1) × 0.05)`, which put a count-1 row at
 * importance + 0.05 while fresh rows were stored at plain importance — the
 * same `(importance, count)` pair landed two ways depending on the writer.
 * The formula is now `min(1, importance + log2(count) × 0.05)` (count 1 equals
 * importance; `calculateReinforcedImportance`), and this migration rewrites
 * `memories.reinforcedImportance` for every row so stored values agree with it.
 *
 * Rows are read up front (better-sqlite3 cannot write mid-iterate), then
 * rewritten in batches of 500, each in its own transaction, with progress
 * reported per batch. Only rows whose stored value differs are written.
 *
 * Migration ID: recompute-reinforced-importance-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  sqliteColumnExists,
} from '../lib/database-utils';
import { calculateReinforcedImportance } from '@/lib/memory/scoring/reinforced-importance';

const MIGRATION_ID = 'recompute-reinforced-importance-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;
const BATCH_SIZE = 500;
const EPSILON = 1e-9;

interface MemoryImportanceRow {
  id: string;
  importance: number | null;
  reinforcementCount: number | null;
  reinforcedImportance: number | null;
}

export const recomputeReinforcedImportanceMigration: Migration = {
  id: MIGRATION_ID,
  description:
    'Recompute memories.reinforcedImportance with min(1, importance + log2(count) × 0.05) so count 1 equals importance (bug 216)',
  introducedInVersion: '4.10.0',
  dependsOn: ['add-memory-gate-fields-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('memories')) return false;
    return (
      sqliteColumnExists('memories', 'reinforcedImportance') &&
      sqliteColumnExists('memories', 'reinforcementCount') &&
      sqliteColumnExists('memories', 'importance')
    );
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let itemsAffected = 0;

    try {
      const db = getSQLiteDatabase();
      const rows = db
        .prepare(
          `SELECT id, importance, reinforcementCount, reinforcedImportance FROM memories`,
        )
        .all() as MemoryImportanceRow[];
      const total = rows.length;
      logger.info('Recomputing reinforced importance', { context: LOG_CONTEXT, total });

      const update = db.prepare(
        `UPDATE memories SET reinforcedImportance = ? WHERE id = ?`,
      );
      const applyBatch = db.transaction((batch: Array<{ id: string; value: number }>) => {
        for (const item of batch) update.run(item.value, item.id);
      });

      for (let start = 0; start < total; start += BATCH_SIZE) {
        const slice = rows.slice(start, start + BATCH_SIZE);
        const changes: Array<{ id: string; value: number }> = [];
        for (const row of slice) {
          const value = calculateReinforcedImportance(
            row.importance ?? 0.5,
            row.reinforcementCount ?? 1,
          );
          if (
            row.reinforcedImportance === null ||
            Math.abs(row.reinforcedImportance - value) > EPSILON
          ) {
            changes.push({ id: row.id, value });
          }
        }
        if (changes.length > 0) {
          applyBatch(changes);
          itemsAffected += changes.length;
        }
        const done = Math.min(start + BATCH_SIZE, total);
        reportProgress(done, total, 'memories');
        logger.debug('Recomputed reinforced-importance batch', {
          context: LOG_CONTEXT,
          scanned: done,
          total,
          rewritten: changes.length,
        });
      }

      logger.info('Recomputed reinforced importance', {
        context: LOG_CONTEXT,
        total,
        rewritten: itemsAffected,
      });

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected,
        message: `Recomputed reinforced importance on ${itemsAffected} of ${total} memories`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Reinforced-importance recompute failed', {
        context: LOG_CONTEXT,
        error: errorMessage,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected,
        message: `Reinforced-importance recompute failed: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
