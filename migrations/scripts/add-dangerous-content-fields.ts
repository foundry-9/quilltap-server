/**
 * Migration: Add Dangerous Content Fields
 *
 * This migration adds dangerous content handling fields:
 * - chat_settings: dangerousContentSettings (JSON string)
 * - connection_profiles: isDangerousCompatible (INTEGER DEFAULT 0)
 * - image_profiles: isDangerousCompatible (INTEGER DEFAULT 0)
 *
 * Note: dangerFlags on messages needs no migration - messages are stored as JSON
 * in TEXT columns, so the new optional field is automatically handled by the schema.
 *
 * Migration ID: add-dangerous-content-fields-v1
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
 * Add Dangerous Content Fields Migration
 */
export const addDangerousContentFieldsMigration: Migration = {
  id: 'add-dangerous-content-fields-v1',
  description: 'Add dangerous content handling fields to chat_settings, connection_profiles, and image_profiles tables',
  introducedInVersion: '2.11.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    // Only run for SQLite backend
    if (!isSQLiteBackend()) {
      return false;
    }

    // Check if any of the target tables are missing the new columns
    const tablesToCheck = [
      { table: 'chat_settings', column: 'dangerousContentSettings' },
      { table: 'connection_profiles', column: 'isDangerousCompatible' },
      { table: 'image_profiles', column: 'isDangerousCompatible' },
    ];

    for (const { table, column } of tablesToCheck) {
      if (!sqliteTableExists(table)) {
        continue;
      }

      const columns = getSQLiteTableColumns(table);
      const columnNames = columns.map((col) => col.name);

      if (!columnNames.includes(column)) {
        return true;
      }
    }

    return false;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      // Default dangerous content settings as JSON
      const defaultDangerousContentSettings = JSON.stringify({
        mode: 'OFF',
        threshold: 0.7,
        scanTextChat: true,
        scanImagePrompts: true,
        scanImageGeneration: false,
        displayMode: 'SHOW',
        showWarningBadges: true,
      });

      // Add dangerousContentSettings to chat_settings
      if (sqliteTableExists('chat_settings')) {
        const chatSettingsColumns = getSQLiteTableColumns('chat_settings');
        const chatSettingsColumnNames = chatSettingsColumns.map((col) => col.name);

        if (!chatSettingsColumnNames.includes('dangerousContentSettings')) {
          db.exec(
            `ALTER TABLE "chat_settings" ADD COLUMN "dangerousContentSettings" TEXT DEFAULT '${defaultDangerousContentSettings}'`
          );
          columnsAdded++;
          logger.info('Added dangerousContentSettings column to chat_settings table', {
            context: 'migration.add-dangerous-content-fields',
          });
        }
      }

      // Add isDangerousCompatible to connection_profiles
      if (sqliteTableExists('connection_profiles')) {
        const connectionColumns = getSQLiteTableColumns('connection_profiles');
        const connectionColumnNames = connectionColumns.map((col) => col.name);

        if (!connectionColumnNames.includes('isDangerousCompatible')) {
          db.exec(`ALTER TABLE "connection_profiles" ADD COLUMN "isDangerousCompatible" INTEGER DEFAULT 0`);
          columnsAdded++;
          logger.info('Added isDangerousCompatible column to connection_profiles table', {
            context: 'migration.add-dangerous-content-fields',
          });
        }
      }

      // Add isDangerousCompatible to image_profiles
      if (sqliteTableExists('image_profiles')) {
        const imageColumns = getSQLiteTableColumns('image_profiles');
        const imageColumnNames = imageColumns.map((col) => col.name);

        if (!imageColumnNames.includes('isDangerousCompatible')) {
          db.exec(`ALTER TABLE "image_profiles" ADD COLUMN "isDangerousCompatible" INTEGER DEFAULT 0`);
          columnsAdded++;
          logger.info('Added isDangerousCompatible column to image_profiles table', {
            context: 'migration.add-dangerous-content-fields',
          });
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('Added dangerous content fields to database tables', {
        context: 'migration.add-dangerous-content-fields',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-dangerous-content-fields-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} dangerous content column(s) to database tables`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add dangerous content fields', {
        context: 'migration.add-dangerous-content-fields',
        error: errorMessage,
      });

      return {
        id: 'add-dangerous-content-fields-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add dangerous content fields',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
