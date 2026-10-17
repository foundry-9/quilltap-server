/**
 * Migration: Add Chat Wardrobe History Table
 *
 * Creates `chat_wardrobe_history`, the outfit record: per (chat × character)
 * a numbered timeline of the outfits worn there, from `0` (what they arrived
 * in), with a cursor on the one they are wearing now. See
 * docs/developer/features/complete/wardrobe-outfit-history.md.
 *
 * The DDL is shared with the repository tests through
 * `lib/database/backends/sqlite/chat-wardrobe-history-ddl.ts`.
 *
 * Migration ID: add-chat-wardrobe-history-table-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';
import {
  CHAT_WARDROBE_HISTORY_DDL,
  CHAT_WARDROBE_HISTORY_TABLE,
} from '@/lib/database/backends/sqlite/chat-wardrobe-history-ddl';

const MIGRATION_ID = 'add-chat-wardrobe-history-table-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;

export const addChatWardrobeHistoryTableMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Create chat_wardrobe_history table: every change of clothes per character per chat, with a cursor',
  introducedInVersion: '4.11.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    return !sqliteTableExists(CHAT_WARDROBE_HISTORY_TABLE);
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();
      for (const statement of CHAT_WARDROBE_HISTORY_DDL) {
        db.exec(statement);
      }

      logger.info('Created chat_wardrobe_history table', { context: LOG_CONTEXT });

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: 1,
        message: 'Created chat_wardrobe_history table',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to create chat_wardrobe_history table', {
        context: LOG_CONTEXT,
        error: errorMessage,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to create chat_wardrobe_history table',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
