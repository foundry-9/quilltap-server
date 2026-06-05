/**
 * Migration: Add thinking / reasoning display columns
 *
 * Powers the Salon's display of reasoning models' chain-of-thought. DISPLAY
 * ONLY — these govern whether captured reasoning is shown, never whether it is
 * stored or fed to a model.
 *
 *  - chats.showThinking INTEGER DEFAULT NULL
 *    Per-chat tri-state override. NULL = inherit the global default; 0 = hide;
 *    1 = show.
 *  - chat_settings.thinkingDisplay TEXT DEFAULT '{"defaultVisible":true,"defaultCollapsed":true}'
 *    Global-default JSON. The ChatSettings schema/repository expect this column,
 *    so without it every chat-settings write fails with `no such column:
 *    thinkingDisplay`.
 *
 * Migration ID: add-thinking-display-fields-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

const THINKING_DISPLAY_DEFAULT = '{"defaultVisible":true,"defaultCollapsed":true}';

export const addThinkingDisplayFieldsMigration: Migration = {
  id: 'add-thinking-display-fields-v1',
  description: 'Add showThinking column to chats and thinkingDisplay column to chat_settings',
  introducedInVersion: '4.6.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chats') || !sqliteTableExists('chat_settings')) {
      return false;
    }

    const chatCols = getSQLiteTableColumns('chats').map((c) => c.name);
    const settingsCols = getSQLiteTableColumns('chat_settings').map((c) => c.name);

    return !chatCols.includes('showThinking') || !settingsCols.includes('thinkingDisplay');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      const chatCols = getSQLiteTableColumns('chats').map((c) => c.name);
      if (!chatCols.includes('showThinking')) {
        db.exec(`ALTER TABLE "chats" ADD COLUMN "showThinking" INTEGER DEFAULT NULL`);
        columnsAdded++;
      }

      const settingsCols = getSQLiteTableColumns('chat_settings').map((c) => c.name);
      if (!settingsCols.includes('thinkingDisplay')) {
        db.exec(
          `ALTER TABLE "chat_settings" ADD COLUMN "thinkingDisplay" TEXT DEFAULT '${THINKING_DISPLAY_DEFAULT}'`
        );
        columnsAdded++;
      }

      const durationMs = Date.now() - startTime;

      logger.info('Added thinking-display columns', {
        context: 'migration.add-thinking-display-fields',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-thinking-display-fields-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} thinking-display column(s)`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add thinking-display columns', {
        context: 'migration.add-thinking-display-fields',
        error: errorMessage,
      });

      return {
        id: 'add-thinking-display-fields-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add thinking-display columns',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
