/**
 * Migration: Add compositionModeDefault Field to Chat Settings
 *
 * This migration adds a compositionModeDefault INTEGER field to the chat_settings table.
 * When enabled, new chats start with composition mode active so Enter inserts a newline
 * and Ctrl/Cmd+Enter submits the message.
 *
 * Migration ID: add-composition-mode-default-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addCompositionModeDefaultFieldMigration: Migration = {
  id: 'add-composition-mode-default-field-v1',
  description: 'Add compositionModeDefault field to chat_settings table for default chat composition mode',
  introducedInVersion: '4.3.0',
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

    return !columnNames.includes('compositionModeDefault');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      const columns = getSQLiteTableColumns('chat_settings');
      const columnNames = columns.map((col) => col.name);

      if (!columnNames.includes('compositionModeDefault')) {
        db.exec(`ALTER TABLE "chat_settings" ADD COLUMN "compositionModeDefault" INTEGER DEFAULT 0`);
        columnsAdded++;
        logger.info('Added compositionModeDefault column to chat_settings table', {
          context: 'migration.add-composition-mode-default-field',
        });
      }

      const durationMs = Date.now() - startTime;

      return {
        id: 'add-composition-mode-default-field-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added compositionModeDefault column to chat_settings table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add compositionModeDefault column', {
        context: 'migration.add-composition-mode-default-field',
        error: errorMessage,
      });

      return {
        id: 'add-composition-mode-default-field-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add compositionModeDefault column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
