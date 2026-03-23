/**
 * Migration: Add Silent Message Field
 *
 * Adds the isSilentMessage column to chat_messages table.
 * This boolean column indicates whether a message was generated while
 * the character was in silent mode (inner thoughts only, no audible dialogue).
 * NULL means the message was generated in normal (active) mode.
 *
 * Migration ID: add-silent-message-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addSilentMessageFieldMigration: Migration = {
  id: 'add-silent-message-field-v1',
  description: 'Add isSilentMessage column to chat_messages for silent character mode',
  introducedInVersion: '2.18.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chat_messages')) {
      return false;
    }

    const columns = getSQLiteTableColumns('chat_messages');
    const columnNames = columns.map((col) => col.name);

    return !columnNames.includes('isSilentMessage');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      db.exec(`ALTER TABLE "chat_messages" ADD COLUMN "isSilentMessage" INTEGER DEFAULT NULL`);

      logger.info('Added isSilentMessage column to chat_messages table', {
        context: 'migration.add-silent-message-field',
      });

      const durationMs = Date.now() - startTime;

      return {
        id: 'add-silent-message-field-v1',
        success: true,
        itemsAffected: 1,
        message: 'Added isSilentMessage column to chat_messages',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add isSilentMessage column', {
        context: 'migration.add-silent-message-field',
        error: errorMessage,
      });

      return {
        id: 'add-silent-message-field-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to add isSilentMessage column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
