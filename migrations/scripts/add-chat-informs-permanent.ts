/**
 * Migration: Add Chat Informs Permanent Column
 *
 * Adds `permanent` (INTEGER NOT NULL DEFAULT 0) to `chat_informs`, marking a
 * **standing** inform: one delivered on every generation its seat makes in the
 * chat until the operator withdraws it, rather than consumed after one turn.
 *
 * The default leaves every existing row a one-shot inform, which is what they
 * all were, so no rows are touched.
 *
 * Migration ID: add-chat-informs-permanent-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
} from '../lib/database-utils';

const MIGRATION_ID = 'add-chat-informs-permanent-v1';

export const addChatInformsPermanentMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Add the permanent (standing inform) flag to chat_informs',
  introducedInVersion: '4.10.0',
  dependsOn: ['add-chat-informs-table-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chat_informs')) {
      return false;
    }

    return !sqliteColumnExists('chat_informs', 'permanent');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      if (addColumnIfMissing('chat_informs', 'permanent', 'INTEGER NOT NULL DEFAULT 0')) {
        columnsAdded++;
      }

      const durationMs = Date.now() - startTime;

      logger.info('Added the permanent column to chat_informs', {
        context: 'migration.add-chat-informs-permanent',
        columnsAdded,
        durationMs,
      });

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} column(s) to chat_informs table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add the permanent column to chat_informs', {
        context: 'migration.add-chat-informs-permanent',
        error: errorMessage,
      });

      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add the permanent column to chat_informs',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
