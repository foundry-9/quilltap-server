/**
 * Migration: Add Chat Concierge Override Field
 *
 * Adds a single column to the chats table:
 * - conciergeOverride (TEXT, default NULL) - per-chat Concierge mode override
 *   - NULL: follow the global Concierge setting; isDangerousChat is authoritative
 *           for Safe vs Flagged
 *   - 'OFF': Concierge is off-duty for this chat. Skip classification, skip
 *            uncensored reroute, skip image-prompt scanning. The operator
 *            explicitly accepts the risk of provider refusals.
 *
 * Default NULL preserves the prior behavior for every existing chat.
 *
 * Migration ID: add-chat-concierge-override-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addChatConciergeOverrideMigration: Migration = {
  id: 'add-chat-concierge-override-v1',
  description: 'Add per-chat Concierge override (Off-duty) column to chats table',
  introducedInVersion: '2.13.0',
  dependsOn: ['sqlite-initial-schema-v1', 'add-chat-danger-classification-fields-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chats')) {
      return false;
    }

    const columns = getSQLiteTableColumns('chats');
    const columnNames = columns.map((col) => col.name);

    return !columnNames.includes('conciergeOverride');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      if (sqliteTableExists('chats')) {
        const chatColumns = getSQLiteTableColumns('chats');
        const chatColumnNames = chatColumns.map((col) => col.name);

        if (!chatColumnNames.includes('conciergeOverride')) {
          db.exec(`ALTER TABLE "chats" ADD COLUMN "conciergeOverride" TEXT DEFAULT NULL`);
          columnsAdded++;
          logger.info('Added conciergeOverride column to chats table', {
            context: 'migration.add-chat-concierge-override',
          });
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('Added Concierge override column to chats table', {
        context: 'migration.add-chat-concierge-override',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-chat-concierge-override-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} Concierge override column(s) to chats table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add Concierge override column', {
        context: 'migration.add-chat-concierge-override',
        error: errorMessage,
      });

      return {
        id: 'add-chat-concierge-override-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add Concierge override column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
