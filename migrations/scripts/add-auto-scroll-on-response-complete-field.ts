/**
 * Migration: Add autoScrollOnResponseComplete Field to Chat Settings
 *
 * Adds an autoScrollOnResponseComplete INTEGER field to the chat_settings table.
 * When enabled, the Salon scrolls to the newest message as an assistant reply
 * finishes streaming or a new message arrives (only when the reader is already
 * near the bottom). It defaults to OFF (0) so that long replies don't yank the
 * reader away from where they are reading.
 *
 * Migration ID: add-auto-scroll-on-response-complete-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addAutoScrollOnResponseCompleteFieldMigration: Migration = {
  id: 'add-auto-scroll-on-response-complete-field-v1',
  description: 'Add autoScrollOnResponseComplete field to chat_settings table for the Salon auto-scroll toggle',
  introducedInVersion: '4.6.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chat_settings')) {
      return false;
    }

    const columns = getSQLiteTableColumns('chat_settings');
    const columnNames = columns.map((col) => col.name);

    return !columnNames.includes('autoScrollOnResponseComplete');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      const columns = getSQLiteTableColumns('chat_settings');
      const columnNames = columns.map((col) => col.name);

      if (!columnNames.includes('autoScrollOnResponseComplete')) {
        db.exec(`ALTER TABLE "chat_settings" ADD COLUMN "autoScrollOnResponseComplete" INTEGER DEFAULT 0`);
        columnsAdded++;
        logger.info('Added autoScrollOnResponseComplete column to chat_settings table', {
          context: 'migration.add-auto-scroll-on-response-complete-field',
        });
      }

      const durationMs = Date.now() - startTime;

      return {
        id: 'add-auto-scroll-on-response-complete-field-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added autoScrollOnResponseComplete column to chat_settings table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add autoScrollOnResponseComplete column', {
        context: 'migration.add-auto-scroll-on-response-complete-field',
        error: errorMessage,
      });

      return {
        id: 'add-auto-scroll-on-response-complete-field-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add autoScrollOnResponseComplete column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
