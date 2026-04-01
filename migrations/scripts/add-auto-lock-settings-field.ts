/**
 * Migration: Add Auto-Lock Settings Field
 *
 * This migration adds the autoLockSettings field to the chat_settings table.
 * Auto-lock allows automatically locking the database after a period of inactivity
 * when a user passphrase is set.
 *
 * Migration ID: add-auto-lock-settings-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

/**
 * Add Auto-Lock Settings Field Migration
 */
export const addAutoLockSettingsFieldMigration: Migration = {
  id: 'add-auto-lock-settings-field-v1',
  description: 'Add autoLockSettings column to chat_settings table',
  introducedInVersion: '2.15.0',
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

    return !columnNames.includes('autoLockSettings');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      const defaultAutoLockSettings = JSON.stringify({
        enabled: false,
        idleMinutes: 15,
      });

      db.exec(
        `ALTER TABLE "chat_settings" ADD COLUMN "autoLockSettings" TEXT DEFAULT '${defaultAutoLockSettings}'`
      );

      const durationMs = Date.now() - startTime;

      logger.info('Added autoLockSettings column to chat_settings table', {
        context: 'migration.add-auto-lock-settings-field',
        durationMs,
      });

      return {
        id: 'add-auto-lock-settings-field-v1',
        success: true,
        itemsAffected: 1,
        message: 'Added autoLockSettings column to chat_settings table',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add autoLockSettings field', {
        context: 'migration.add-auto-lock-settings-field',
        error: errorMessage,
      });

      return {
        id: 'add-auto-lock-settings-field-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to add autoLockSettings field',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
