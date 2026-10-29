/**
 * Migration: Keystone memories.
 *
 * Adds `memories.keystone` (INTEGER NOT NULL DEFAULT 0): the operator has
 * marked the row a standing fact, always delivered to its holder in full and
 * never folded, consolidated or demoted. Plus a partial index on
 * (characterId, aboutCharacterId) over keystone rows, which the frozen archive
 * reads once per present character, the holder and each inner-circle member.
 *
 * `ADD COLUMN ... DEFAULT 0` stamps every existing row, so there is no
 * backfill loop. Design of record: docs/developer/features/complete/inner-circle-recall.md
 * (Part C).
 *
 * Migration ID: add-memory-keystone-v1
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

const MIGRATION_ID = 'add-memory-keystone-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;
const INDEX_NAME = 'idx_memories_keystone';

function hasIndex(): boolean {
  return !!getSQLiteDatabase()
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`)
    .get(INDEX_NAME);
}

export const addMemoryKeystoneMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Add keystone to memories (+ partial (characterId, aboutCharacterId) index over keystones)',
  introducedInVersion: '4.11.0',
  dependsOn: ['add-memory-tiers-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('memories')) return false;
    return !sqliteColumnExists('memories', 'keystone') || !hasIndex();
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let itemsAffected = 0;
    try {
      if (addColumnIfMissing('memories', 'keystone', 'INTEGER NOT NULL DEFAULT 0')) {
        itemsAffected++;
        logger.info('Added memories.keystone column', { context: LOG_CONTEXT });
      }
      if (!hasIndex()) {
        getSQLiteDatabase().exec(
          `CREATE INDEX IF NOT EXISTS "${INDEX_NAME}" ON "memories" ("characterId", "aboutCharacterId") WHERE "keystone" = 1`,
        );
        itemsAffected++;
        logger.info(`Created ${INDEX_NAME}`, { context: LOG_CONTEXT });
      }
      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected,
        message: `Keystone memories in place (${itemsAffected} changes)`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Keystone-memory migration failed', { context: LOG_CONTEXT, error: errorMessage });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected,
        message: `Keystone-memory migration failed: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
