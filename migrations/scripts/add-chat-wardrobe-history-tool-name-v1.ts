/**
 * Migration: Add actorToolName to Chat Wardrobe History
 *
 * Adds `chat_wardrobe_history.actorToolName`: for an entry a custom tool's
 * wardrobe effects made (`source = 'pascal'`), the name of that tool. Existing
 * rows keep NULL — the tool that made them was never recorded, and the
 * readers label such an entry plain "Pascal".
 *
 * A fresh table already has the column (the shared DDL carries it); this
 * migration only reaches tables created before it existed.
 *
 * Migration ID: add-chat-wardrobe-history-tool-name-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
} from '../lib/database-utils';
import {
  CHAT_WARDROBE_HISTORY_TABLE,
  CHAT_WARDROBE_HISTORY_TOOL_NAME_COLUMN,
} from '@/lib/database/backends/sqlite/chat-wardrobe-history-ddl';

const MIGRATION_ID = 'add-chat-wardrobe-history-tool-name-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;

export const addChatWardrobeHistoryToolNameMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Add actorToolName to chat_wardrobe_history: the custom tool behind a Pascal outfit change',
  introducedInVersion: '4.11.0',
  dependsOn: ['add-chat-wardrobe-history-table-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists(CHAT_WARDROBE_HISTORY_TABLE)) return false;
    return !sqliteColumnExists(CHAT_WARDROBE_HISTORY_TABLE, CHAT_WARDROBE_HISTORY_TOOL_NAME_COLUMN);
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    try {
      const added = addColumnIfMissing(CHAT_WARDROBE_HISTORY_TABLE, CHAT_WARDROBE_HISTORY_TOOL_NAME_COLUMN, 'TEXT');
      if (added) {
        logger.info('Added actorToolName column to chat_wardrobe_history', { context: LOG_CONTEXT });
      }
      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: added ? 1 : 0,
        message: 'Added actorToolName column to chat_wardrobe_history',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to add actorToolName column to chat_wardrobe_history', {
        context: LOG_CONTEXT,
        error: errorMessage,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to add actorToolName column to chat_wardrobe_history',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
