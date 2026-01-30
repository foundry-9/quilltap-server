/**
 * Migration: Add Tool Settings Fields to Chats
 *
 * This migration adds the tool settings fields to the chats table:
 * - disabledTools: JSON array of individually disabled tool IDs
 * - disabledToolGroups: JSON array of disabled group patterns
 * - forceToolsOnNextMessage: Boolean flag to force tool re-injection
 *
 * Migration ID: add-chat-tool-settings-fields-v1
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
 * Add Chat Tool Settings Fields Migration
 */
export const addChatToolSettingsFieldsMigration: Migration = {
  id: 'add-chat-tool-settings-fields-v1',
  description: 'Add tool settings fields (disabledTools, disabledToolGroups, forceToolsOnNextMessage) to chats table',
  introducedInVersion: '2.8.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    // Only run for SQLite backend
    if (!isSQLiteBackend()) {
      return false;
    }

    // Check if chats table exists
    if (!sqliteTableExists('chats')) {
      return false;
    }

    // Check if any of the columns already exist
    const columns = getSQLiteTableColumns('chats');
    const columnNames = columns.map((col) => col.name);

    const hasDisabledTools = columnNames.includes('disabledTools');
    const hasDisabledToolGroups = columnNames.includes('disabledToolGroups');
    const hasForceToolsOnNextMessage = columnNames.includes('forceToolsOnNextMessage');

    // Run if any column is missing
    if (!hasDisabledTools || !hasDisabledToolGroups || !hasForceToolsOnNextMessage) {
      return true;
    }

    return false;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();
      const columns = getSQLiteTableColumns('chats');
      const columnNames = columns.map((col) => col.name);

      // Add disabledTools column if missing
      if (!columnNames.includes('disabledTools')) {
        db.exec(`ALTER TABLE "chats" ADD COLUMN "disabledTools" TEXT DEFAULT '[]'`);
        columnsAdded++;
        logger.info('Added disabledTools column to chats table', {
          context: 'migration.add-chat-tool-settings-fields',
        });
      }

      // Add disabledToolGroups column if missing
      if (!columnNames.includes('disabledToolGroups')) {
        db.exec(`ALTER TABLE "chats" ADD COLUMN "disabledToolGroups" TEXT DEFAULT '[]'`);
        columnsAdded++;
        logger.info('Added disabledToolGroups column to chats table', {
          context: 'migration.add-chat-tool-settings-fields',
        });
      }

      // Add forceToolsOnNextMessage column if missing
      if (!columnNames.includes('forceToolsOnNextMessage')) {
        db.exec(`ALTER TABLE "chats" ADD COLUMN "forceToolsOnNextMessage" INTEGER DEFAULT 0`);
        columnsAdded++;
        logger.info('Added forceToolsOnNextMessage column to chats table', {
          context: 'migration.add-chat-tool-settings-fields',
        });
      }

      const durationMs = Date.now() - startTime;

      logger.info('Added tool settings columns to chats table', {
        context: 'migration.add-chat-tool-settings-fields',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-chat-tool-settings-fields-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} tool settings column(s) to chats table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add tool settings columns', {
        context: 'migration.add-chat-tool-settings-fields',
        error: errorMessage,
      });

      return {
        id: 'add-chat-tool-settings-fields-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add tool settings columns',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
