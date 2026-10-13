/**
 * Migration: retire the INTER_CHARACTER_MEMORY job type (memory refactor Phase D).
 *
 * Inter-character extraction has run inside the per-turn MEMORY_EXTRACTION job
 * for a long while; the INTER_CHARACTER_MEMORY handler was an empty drain kept
 * only so old queued rows could finish. The type is now gone from the job
 * schema, so any row still carrying it would fail to parse. This deletes them
 * (they never did any work).
 *
 * Migration ID: drop-inter-character-memory-jobs-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { isSQLiteBackend, getSQLiteDatabase, sqliteTableExists } from '../lib/database-utils';

const MIGRATION_ID = 'drop-inter-character-memory-jobs-v1';

export const dropInterCharacterMemoryJobsMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Delete background jobs of the retired INTER_CHARACTER_MEMORY type',
  introducedInVersion: '4.10.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('background_jobs')) return false;
    const db = getSQLiteDatabase();
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM "background_jobs" WHERE "type" = 'INTER_CHARACTER_MEMORY'`)
      .get() as { n: number };
    return row.n > 0;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    try {
      const db = getSQLiteDatabase();
      const result = db.prepare(`DELETE FROM "background_jobs" WHERE "type" = 'INTER_CHARACTER_MEMORY'`).run();
      logger.info('Deleted retired INTER_CHARACTER_MEMORY jobs', {
        context: `migration.${MIGRATION_ID}`,
        deleted: result.changes,
      });
      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: result.changes,
        message: `Deleted ${result.changes} retired INTER_CHARACTER_MEMORY job(s)`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to delete INTER_CHARACTER_MEMORY jobs', { context: `migration.${MIGRATION_ID}`, error: errorMessage });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to delete INTER_CHARACTER_MEMORY jobs',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
