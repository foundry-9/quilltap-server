/**
 * Migration: Add a supersededById index on memories
 *
 * The delete chokepoint asks "which surviving rows did this deleted digest
 * supersede?" (`supersededById IN (...)`) on every memory delete, and
 * `findSupersededBy` asks it per digest. Without an index each question was a
 * full scan of the memories table. This creates `idx_memories_supersededById`,
 * partial on `supersededById IS NOT NULL` — only superseded cold rows carry
 * one, so the index stays small.
 *
 * A single CREATE INDEX statement: no per-row loop to report progress from.
 *
 * Migration ID: add-memories-superseded-by-index-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  sqliteColumnExists,
} from '../lib/database-utils';

const MIGRATION_ID = 'add-memories-superseded-by-index-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;
const INDEX_NAME = 'idx_memories_supersededById';

function indexExists(): boolean {
  const row = getSQLiteDatabase()
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?")
    .get(INDEX_NAME);
  return !!row;
}

export const addMemoriesSupersededByIndexMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Add a partial supersededById index to memories for the delete chokepoint digest scrub',
  introducedInVersion: '4.10.0',
  dependsOn: ['add-memory-tiers-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('memories')) return false;
    if (!sqliteColumnExists('memories', 'supersededById')) return false;
    return !indexExists();
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    try {
      getSQLiteDatabase().exec(
        `CREATE INDEX IF NOT EXISTS "${INDEX_NAME}" ON "memories" ("supersededById") WHERE "supersededById" IS NOT NULL`
      );
      if (!indexExists()) {
        throw new Error('Index was not created');
      }
      logger.info(`Added ${INDEX_NAME} index`, { context: LOG_CONTEXT });
      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: 1,
        message: `Created ${INDEX_NAME} on memories(supersededById) WHERE supersededById IS NOT NULL`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to add ${INDEX_NAME} index`, { context: LOG_CONTEXT, error: errorMessage });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: `Failed to add ${INDEX_NAME}: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
