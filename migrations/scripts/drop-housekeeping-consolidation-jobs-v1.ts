/**
 * Migration: retire the MEMORY_HOUSEKEEPING and MEMORY_CONSOLIDATION job types
 * (memory refactor Phase F).
 *
 * Both are now phases of the one MEMORY_MAINTENANCE job, and the two types are
 * gone from the job schema, so any row still carrying either would fail to
 * parse. This deletes them. A queued run that is lost this way is picked up by
 * the next daily sweep or watermark; completed rows were history only (the
 * scheduler's "ran recently" check now reads MEMORY_MAINTENANCE rows).
 *
 * Migration ID: drop-housekeeping-consolidation-jobs-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { isSQLiteBackend, getSQLiteDatabase, sqliteTableExists } from '../lib/database-utils';

const MIGRATION_ID = 'drop-housekeeping-consolidation-jobs-v1';

export const dropHousekeepingConsolidationJobsMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Delete background jobs of the retired MEMORY_HOUSEKEEPING and MEMORY_CONSOLIDATION types',
  introducedInVersion: '4.10.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('background_jobs')) return false;
    const db = getSQLiteDatabase();
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM "background_jobs" WHERE "type" IN ('MEMORY_HOUSEKEEPING', 'MEMORY_CONSOLIDATION')`)
      .get() as { n: number };
    return row.n > 0;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    try {
      const db = getSQLiteDatabase();
      const result = db.prepare(`DELETE FROM "background_jobs" WHERE "type" IN ('MEMORY_HOUSEKEEPING', 'MEMORY_CONSOLIDATION')`).run();
      logger.info('Deleted retired housekeeping and consolidation jobs', {
        context: `migration.${MIGRATION_ID}`,
        deleted: result.changes,
      });
      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: result.changes,
        message: `Deleted ${result.changes} retired housekeeping/consolidation job(s)`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to delete housekeeping and consolidation jobs', { context: `migration.${MIGRATION_ID}`, error: errorMessage });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to delete housekeeping and consolidation jobs',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
