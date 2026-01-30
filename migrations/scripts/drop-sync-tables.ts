/**
 * Drop Sync Tables Migration
 *
 * Removes all sync-related database tables that are no longer used.
 * Sync functionality has been removed from Quilltap.
 */

import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';
import type { Migration, MigrationResult } from '../types';

const SYNC_TABLES = [
  'sync_instances',
  'sync_mappings',
  'sync_operations',
  'user_sync_api_keys',
];

export const dropSyncTablesMigration: Migration = {
  id: 'drop-sync-tables-v1',
  description: 'Remove all sync-related database tables',
  introducedInVersion: '2.8.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    // Only run for SQLite backend
    if (!isSQLiteBackend()) {
      return false;
    }

    // Check if any sync tables still exist
    for (const table of SYNC_TABLES) {
      if (sqliteTableExists(table)) {
        return true;
      }
    }
    return false;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let tablesDropped = 0;

    try {
      const db = getSQLiteDatabase();

      for (const table of SYNC_TABLES) {
        if (sqliteTableExists(table)) {
          db.exec(`DROP TABLE IF EXISTS "${table}"`);
          tablesDropped++;
          logger.info(`Dropped sync table: ${table}`, {
            context: 'migrations.drop-sync-tables.run',
          });
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('Drop sync tables migration completed', {
        context: 'migrations.drop-sync-tables.run',
        tablesDropped,
        durationMs,
      });

      return {
        id: 'drop-sync-tables-v1',
        success: true,
        itemsAffected: tablesDropped,
        message: `Dropped ${tablesDropped} sync tables`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Drop sync tables migration failed', {
        context: 'migrations.drop-sync-tables.run',
        error: errorMessage,
      });

      return {
        id: 'drop-sync-tables-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to drop sync tables',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
