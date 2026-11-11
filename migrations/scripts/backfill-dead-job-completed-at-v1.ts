/**
 * Migration: stamp `completedAt` on DEAD background jobs that lack one (#194).
 *
 * The reaper keys DEAD rows on `completedAt`, but no path that set DEAD ever
 * wrote it, so every DEAD job lived forever. The writers now stamp it; this
 * backfills the rows already there with `updatedAt`, the moment they died.
 * One UPDATE, so no progress reporting.
 *
 * Migration ID: backfill-dead-job-completed-at-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { isSQLiteBackend, getSQLiteDatabase, sqliteTableExists } from '../lib/database-utils';

const MIGRATION_ID = 'backfill-dead-job-completed-at-v1';

const WHERE_UNSTAMPED = `"status" = 'DEAD' AND "completedAt" IS NULL`;

export const backfillDeadJobCompletedAtMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Stamp completedAt on DEAD background jobs so the reaper can retire them',
  introducedInVersion: '4.13.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('background_jobs')) return false;
    const db = getSQLiteDatabase();
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM "background_jobs" WHERE ${WHERE_UNSTAMPED}`)
      .get() as { n: number };
    return row.n > 0;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    try {
      const db = getSQLiteDatabase();
      const result = db
        .prepare(`UPDATE "background_jobs" SET "completedAt" = "updatedAt" WHERE ${WHERE_UNSTAMPED}`)
        .run();
      logger.info('Stamped completedAt on DEAD background jobs', {
        context: `migration.${MIGRATION_ID}`,
        updated: result.changes,
      });
      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: result.changes,
        message: `Stamped completedAt on ${result.changes} DEAD job(s)`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to stamp completedAt on DEAD jobs', { context: `migration.${MIGRATION_ID}`, error: errorMessage });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to stamp completedAt on DEAD jobs',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
