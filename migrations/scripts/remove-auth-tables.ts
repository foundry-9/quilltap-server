/**
 * Remove Auth Tables Migration
 *
 * Quilltap now operates in single-user mode only.
 * This migration drops the accounts and sessions tables that are no longer needed.
 *
 * Note: SQLite doesn't easily drop columns, so the unused auth fields in the
 * users table (totp, backupCodes, totpAttempts, trustedDevices) are left in place
 * but are no longer used.
 */

import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';
import type { Migration, MigrationResult } from '../types';

export const removeAuthTablesMigration: Migration = {
  id: 'remove-auth-tables-v1',
  description: 'Drop accounts and sessions tables (single-user mode)',
  introducedInVersion: '2.8.0',

  async shouldRun(): Promise<boolean> {
    // Only run for SQLite backend
    if (!isSQLiteBackend()) {
      return false;
    }

    // Check if either table exists
    return sqliteTableExists('accounts') || sqliteTableExists('sessions');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let tablesDropped = 0;

    try {
      const db = getSQLiteDatabase();

      // Drop tables in a transaction
      const dropTables = db.transaction(() => {
        if (sqliteTableExists('accounts')) {
          db.exec('DROP TABLE IF EXISTS "accounts"');
          tablesDropped++;
          logger.info('Dropped accounts table', {
            context: 'migrations.remove-auth-tables.run',
          });
        }

        if (sqliteTableExists('sessions')) {
          db.exec('DROP TABLE IF EXISTS "sessions"');
          tablesDropped++;
          logger.info('Dropped sessions table', {
            context: 'migrations.remove-auth-tables.run',
          });
        }
      });

      dropTables();

      const durationMs = Date.now() - startTime;

      logger.info('Auth tables migration completed', {
        context: 'migrations.remove-auth-tables.run',
        tablesDropped,
        durationMs,
      });

      return {
        id: 'remove-auth-tables-v1',
        success: true,
        itemsAffected: tablesDropped,
        message: `Dropped ${tablesDropped} auth table(s)`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Auth tables migration failed', {
        context: 'migrations.remove-auth-tables.run',
        error: errorMessage,
      });

      return {
        id: 'remove-auth-tables-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to drop auth tables',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
