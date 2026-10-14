/**
 * Migration: memories.supersededAt — the cold-retention clock (bug 225).
 *
 * `coldRetentionDays` deletes cold rows a digest superseded once they are old
 * enough. It used to age them by `updatedAt`, which every write resets —
 * consolidation's link rewrites and the delete chokepoint's neighbour scrub
 * included — so a member that kept being re-linked never aged out. This adds
 *
 *  - memories.supersededAt  TEXT — when the row went cold under its digest
 *
 * and backfills it from `updatedAt` for rows that already carry a
 * `supersededById` (the best record of when they were superseded that
 * exists). From here on `updateTierBulk` stamps it alongside
 * `supersededById` and clears it when that link is cut.
 *
 * The backfill is one UPDATE statement, so there is no per-row loop to
 * report progress from.
 *
 * Migration ID: add-memory-superseded-at-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
} from '../lib/database-utils';

const MIGRATION_ID = 'add-memory-superseded-at-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;
const COLUMN = 'supersededAt';

interface WorkNeeded {
  needsColumn: boolean;
  unstampedRows: number;
}

function assessWork(): WorkNeeded {
  const work: WorkNeeded = { needsColumn: false, unstampedRows: 0 };
  if (!isSQLiteBackend() || !sqliteTableExists('memories')) return work;

  work.needsColumn = !sqliteColumnExists('memories', COLUMN);
  if (!sqliteColumnExists('memories', 'supersededById')) return work;

  const db = getSQLiteDatabase();
  if (work.needsColumn) {
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM memories WHERE supersededById IS NOT NULL`)
      .get() as { n: number | bigint };
    work.unstampedRows = Number(row.n);
  } else {
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM memories WHERE supersededById IS NOT NULL AND ${COLUMN} IS NULL`)
      .get() as { n: number | bigint };
    work.unstampedRows = Number(row.n);
  }
  return work;
}

export const addMemorySupersededAtMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Add memories.supersededAt (cold-retention clock) and backfill it from updatedAt for superseded rows',
  introducedInVersion: '4.10.0',
  dependsOn: ['add-memory-tiers-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    const work = assessWork();
    return work.needsColumn || work.unstampedRows > 0;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let itemsAffected = 0;

    try {
      const db = getSQLiteDatabase();
      const work = assessWork();

      if (work.needsColumn && addColumnIfMissing('memories', COLUMN, 'TEXT DEFAULT NULL')) {
        itemsAffected++;
        logger.info(`Added memories.${COLUMN} column`, { context: LOG_CONTEXT });
      }

      if (sqliteTableExists('memories') && sqliteColumnExists('memories', 'supersededById')) {
        const stamped = db
          .prepare(
            `UPDATE memories
                SET ${COLUMN} = updatedAt
              WHERE supersededById IS NOT NULL AND ${COLUMN} IS NULL`,
          )
          .run();
        if (stamped.changes > 0) {
          itemsAffected += stamped.changes;
          logger.info('Backfilled supersededAt from updatedAt for superseded memories', {
            context: LOG_CONTEXT,
            rows: stamped.changes,
          });
        }
      }

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected,
        message: `Memory supersession clock in place (${itemsAffected} changes)`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Memory supersededAt migration failed', {
        context: LOG_CONTEXT,
        error: errorMessage,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected,
        message: `Memory supersededAt migration failed: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
