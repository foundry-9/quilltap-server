/**
 * Migration: Add Autonomous Budget Cache-Counting Mode
 *
 * Adds a single `budgetExcludeCacheHits` column to `chats` — the per-run
 * token-budget counting mode for 4.6 Private Character Rooms.
 *
 *  - 1 (default): exclude prompt-cache hit (cache-read) tokens from the
 *    per-run token budget, so only the billable cache-miss input + output
 *    tokens count toward `budgetMaxTokens` / `runTokensConsumed`. This matches
 *    the behavior the provider plugins already produce (they strip cache reads
 *    from `usage.totalTokens` at the source).
 *  - 0: count every token, including cache reads, the way budgets behaved
 *    before cache-read normalization. The stripped cache-read tokens are added
 *    back from `cacheUsage.cacheReadInputTokens` at accounting time.
 *
 * Existing rows default to 1, preserving the current cache-excluding behavior.
 *
 * `chats` (default 1; existing rows unaffected):
 *  - budgetExcludeCacheHits INTEGER DEFAULT 1
 *
 * Migration ID: add-autonomous-budget-cache-mode-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

interface ColumnSpec {
  name: string;
  ddl: string;
}

const CHATS_COLUMNS: ColumnSpec[] = [
  { name: 'budgetExcludeCacheHits', ddl: 'INTEGER DEFAULT 1' },
];

export const addAutonomousBudgetCacheModeMigration: Migration = {
  id: 'add-autonomous-budget-cache-mode-v1',
  description: 'Add budgetExcludeCacheHits column to chats so the per-run token budget can optionally count all tokens including prompt-cache hits',
  introducedInVersion: '4.6.1',
  dependsOn: ['sqlite-initial-schema-v1', 'add-autonomous-rooms-fields-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chats')) {
      return false;
    }

    const chatColumnNames = getSQLiteTableColumns('chats').map((c) => c.name);
    return CHATS_COLUMNS.some((col) => !chatColumnNames.includes(col.name));
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      const chatColumnNames = new Set(getSQLiteTableColumns('chats').map((c) => c.name));
      for (const col of CHATS_COLUMNS) {
        if (!chatColumnNames.has(col.name)) {
          db.exec(`ALTER TABLE "chats" ADD COLUMN "${col.name}" ${col.ddl}`);
          columnsAdded++;
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('Added budgetExcludeCacheHits column to chats', {
        context: 'migration.add-autonomous-budget-cache-mode',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-autonomous-budget-cache-mode-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} column(s) to chats`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add budgetExcludeCacheHits column to chats', {
        context: 'migration.add-autonomous-budget-cache-mode',
        error: errorMessage,
      });

      return {
        id: 'add-autonomous-budget-cache-mode-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add budgetExcludeCacheHits column to chats',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
