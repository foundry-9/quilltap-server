/**
 * Migration: Add Auto-Housekeeping Settings Field
 *
 * Adds the autoHousekeepingSettings column to the chat_settings table.
 * Auto-housekeeping controls whether the Commonplace Book automatically
 * prunes low-importance / stale memories once a per-character cap is
 * approached. Default values match AutoHousekeepingSettingsSchema:
 * disabled, cap 2000, merge threshold 0.90, mergeSimilar off.
 *
 * Migration ID: add-auto-housekeeping-settings-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addAutoHousekeepingSettingsFieldMigration: Migration = {
  id: 'add-auto-housekeeping-settings-field-v1',
  description: 'Add autoHousekeepingSettings column to chat_settings table',
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

    return !columnNames.includes('autoHousekeepingSettings');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      const defaultAutoHousekeepingSettings = JSON.stringify({
        enabled: false,
        perCharacterCap: 2000,
        perCharacterCapOverrides: {},
        autoMergeSimilarThreshold: 0.90,
        mergeSimilar: false,
      });

      db.exec(
        `ALTER TABLE "chat_settings" ADD COLUMN "autoHousekeepingSettings" TEXT DEFAULT '${defaultAutoHousekeepingSettings}'`
      );

      const durationMs = Date.now() - startTime;

      logger.info('Added autoHousekeepingSettings column to chat_settings table', {
        context: 'migration.add-auto-housekeeping-settings-field',
        durationMs,
      });

      return {
        id: 'add-auto-housekeeping-settings-field-v1',
        success: true,
        itemsAffected: 1,
        message: 'Added autoHousekeepingSettings column to chat_settings table',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add autoHousekeepingSettings field', {
        context: 'migration.add-auto-housekeeping-settings-field',
        error: errorMessage,
      });

      return {
        id: 'add-auto-housekeeping-settings-field-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to add autoHousekeepingSettings field',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
