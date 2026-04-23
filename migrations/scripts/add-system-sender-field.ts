/**
 * Migration: Add System Sender Field
 *
 * Adds the systemSender column to chat_messages table. This column identifies
 * a personified feature (e.g., 'lantern') that authored a message in lieu of a
 * participant, so the UI can attribute announcements like Lantern image
 * notifications to the feature itself instead of falling through to a default
 * character.
 *
 * Migration ID: add-system-sender-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addSystemSenderFieldMigration: Migration = {
  id: 'add-system-sender-field-v1',
  description: 'Add systemSender column to chat_messages for personified-feature announcements',
  introducedInVersion: '2.19.0',
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

    return !columnNames.includes('systemSender');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      db.exec(`ALTER TABLE "chat_messages" ADD COLUMN "systemSender" TEXT DEFAULT NULL`);

      logger.info('Added systemSender column to chat_messages table', {
        context: 'migration.add-system-sender-field',
      });

      const durationMs = Date.now() - startTime;

      return {
        id: 'add-system-sender-field-v1',
        success: true,
        itemsAffected: 1,
        message: 'Added systemSender column to chat_messages',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add systemSender column', {
        context: 'migration.add-system-sender-field',
        error: errorMessage,
      });

      return {
        id: 'add-system-sender-field-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to add systemSender column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
