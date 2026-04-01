/**
 * Migration: Add Chat Type Field
 *
 * Adds chatType and helpPageUrl fields to the chats table.
 * chatType discriminates between regular 'salon' chats and 'help' assistant chats.
 * helpPageUrl tracks the current page URL for help chat context resolution.
 *
 * Migration ID: add-chat-type-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addChatTypeFieldMigration: Migration = {
  id: 'add-chat-type-field-v1',
  description: 'Add chatType and helpPageUrl fields to chats table',
  introducedInVersion: '3.3.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chats')) {
      return false;
    }

    const columns = getSQLiteTableColumns('chats');
    const columnNames = columns.map((col) => col.name);
    return !columnNames.includes('chatType');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      db.exec(`ALTER TABLE "chats" ADD COLUMN "chatType" TEXT DEFAULT 'salon'`);
      db.exec(`ALTER TABLE "chats" ADD COLUMN "helpPageUrl" TEXT DEFAULT NULL`);
      db.exec(`CREATE INDEX IF NOT EXISTS "idx_chats_chatType" ON "chats"("chatType")`);

      const durationMs = Date.now() - startTime;

      logger.info('Added chatType and helpPageUrl columns to chats table', {
        context: 'migration.add-chat-type-field',
        durationMs,
      });

      return {
        id: 'add-chat-type-field-v1',
        success: true,
        itemsAffected: 2,
        message: 'Added chatType and helpPageUrl columns to chats table',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add chat type fields', {
        context: 'migration.add-chat-type-field',
        error: errorMessage,
      });

      return {
        id: 'add-chat-type-field-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to add chat type fields',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
