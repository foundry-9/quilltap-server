/**
 * Migration: Add reinforcedImportance Index on memories
 *
 * Creates `idx_memories_reinforcedImportance` so the new `quilltap memories ls`
 * default sort (`ORDER BY reinforcedImportance DESC`) can use an index instead
 * of scanning + sorting the whole table. Instances with tens of thousands of
 * memories notice the difference.
 *
 * Migration ID: add-memories-reinforced-importance-index-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';

export const addMemoriesReinforcedImportanceIndexMigration: Migration = {
  id: 'add-memories-reinforced-importance-index-v1',
  description: 'Add reinforcedImportance index to memories table for CLI default sort',
  introducedInVersion: '4.5.0',
  dependsOn: ['add-memory-gate-fields-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }
    if (!sqliteTableExists('memories')) {
      return false;
    }
    const db = getSQLiteDatabase();
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_memories_reinforcedImportance'"
      )
      .get();
    return !row;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();
      db.exec(
        'CREATE INDEX IF NOT EXISTS "idx_memories_reinforcedImportance" ON "memories" ("reinforcedImportance" DESC)'
      );

      const verify = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_memories_reinforcedImportance'"
        )
        .get();
      if (!verify) {
        throw new Error('Index was not created');
      }

      logger.info('Added idx_memories_reinforcedImportance index', {
        context: 'migration.add-memories-reinforced-importance-index',
      });

      return {
        id: 'add-memories-reinforced-importance-index-v1',
        success: true,
        itemsAffected: 1,
        message: 'Created idx_memories_reinforcedImportance on memories(reinforcedImportance DESC)',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Failed to add idx_memories_reinforcedImportance index', {
        context: 'migration.add-memories-reinforced-importance-index',
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        id: 'add-memories-reinforced-importance-index-v1',
        success: false,
        itemsAffected: 0,
        message: `Failed to add idx_memories_reinforcedImportance: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
