/**
 * Migration: Add Chat Refusal Ledger Columns
 *
 * Adds two columns to the chats table so the Concierge can keep a tally of
 * moderation refusals a chat has earned:
 * - moderationRefusalCount (INTEGER NOT NULL DEFAULT 0) — stated moderation
 *   refusals since the chat was last set to Monitored
 * - lastModerationRefusalAt (TEXT, default NULL) — ISO timestamp of the most
 *   recent one
 *
 * Written only by `recordModerationRefusal`
 * (`lib/services/dangerous-content/refusal-ledger.ts`). The defaults leave
 * every existing chat with an empty ledger, so no rows are touched.
 *
 * Migration ID: add-chat-refusal-ledger-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
} from '../lib/database-utils';

const MIGRATION_ID = 'add-chat-refusal-ledger-v1';

export const addChatRefusalLedgerMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Add the Concierge refusal ledger (moderationRefusalCount, lastModerationRefusalAt) to chats',
  introducedInVersion: '4.10.0',
  dependsOn: ['add-chat-concierge-override-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chats')) {
      return false;
    }

    return (
      !sqliteColumnExists('chats', 'moderationRefusalCount') ||
      !sqliteColumnExists('chats', 'lastModerationRefusalAt')
    );
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      if (addColumnIfMissing('chats', 'moderationRefusalCount', 'INTEGER NOT NULL DEFAULT 0')) {
        columnsAdded++;
      }
      if (addColumnIfMissing('chats', 'lastModerationRefusalAt', 'TEXT DEFAULT NULL')) {
        columnsAdded++;
      }

      const durationMs = Date.now() - startTime;

      logger.info('Added the Concierge refusal ledger columns to chats', {
        context: 'migration.add-chat-refusal-ledger',
        columnsAdded,
        durationMs,
      });

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} refusal ledger column(s) to chats table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add the Concierge refusal ledger columns', {
        context: 'migration.add-chat-refusal-ledger',
        error: errorMessage,
      });

      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add the Concierge refusal ledger columns',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
