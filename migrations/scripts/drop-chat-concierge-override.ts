/**
 * Migration: Drop the Legacy Chat Concierge Override Column
 *
 * Concierge overhaul phase 3 replaced `chats.conciergeOverride` with the
 * `conciergeMode` / `conciergeModeSetBy` / `conciergeModeReason` trio and
 * stopped writing it; `add-chat-concierge-mode-v1` backfilled the trio from
 * it. Phase 4 removes the dead column so no later reader mistakes it for live
 * behaviour.
 *
 * No index or trigger names the column, so a plain
 * `ALTER TABLE ... DROP COLUMN` is enough (SQLite 3.35+; better-sqlite3
 * bundles 3.45+). Old `.qtap` bundles and backups that still carry the field
 * are unaffected: the importer and the restore derive `conciergeMode` from
 * the raw JSON before the row is written.
 *
 * Migration ID: drop-chat-concierge-override-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  sqliteColumnExists,
} from '../lib/database-utils';

const MIGRATION_ID = 'drop-chat-concierge-override-v1';

export const dropChatConciergeOverrideMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Drop the legacy chats.conciergeOverride column, superseded by conciergeMode',
  introducedInVersion: '4.10.0',
  dependsOn: ['add-chat-concierge-mode-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }
    if (!sqliteTableExists('chats')) {
      return false;
    }
    return sqliteColumnExists('chats', 'conciergeOverride');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      logger.debug('Dropping the legacy conciergeOverride column from chats', {
        context: 'migration.drop-chat-concierge-override',
      });

      getSQLiteDatabase().exec('ALTER TABLE "chats" DROP COLUMN "conciergeOverride"');

      const durationMs = Date.now() - startTime;
      logger.info('Dropped the legacy conciergeOverride column from chats', {
        context: 'migration.drop-chat-concierge-override',
        durationMs,
      });

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: 1,
        message: 'Dropped chats.conciergeOverride',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to drop the legacy conciergeOverride column', {
        context: 'migration.drop-chat-concierge-override',
        error: errorMessage,
      });

      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to drop chats.conciergeOverride',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
