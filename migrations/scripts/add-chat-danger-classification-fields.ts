/**
 * Migration: Add Chat Danger Classification Fields
 *
 * This migration adds chat-level danger classification fields to the chats table:
 * - isDangerousChat (INTEGER, nullable) - Whether chat has been classified as dangerous
 * - dangerScore (REAL, nullable) - Overall danger score (0-1)
 * - dangerCategories (TEXT, default '[]') - JSON array of category strings
 * - dangerClassifiedAt (TEXT, nullable) - When classification last ran
 * - dangerClassifiedAtMessageCount (INTEGER, nullable) - Message count at classification time
 *
 * These fields support background chat-level danger classification using the
 * compressed context summary, with results surfaced in the quick-hide system.
 *
 * Migration ID: add-chat-danger-classification-fields-v1
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
 * Add Chat Danger Classification Fields Migration
 */
export const addChatDangerClassificationFieldsMigration: Migration = {
  id: 'add-chat-danger-classification-fields-v1',
  description: 'Add chat-level danger classification fields to chats table',
  introducedInVersion: '2.12.0',
  dependsOn: ['sqlite-initial-schema-v1', 'add-dangerous-content-fields-v1'],

  async shouldRun(): Promise<boolean> {
    // Only run for SQLite backend
    if (!isSQLiteBackend()) {
      return false;
    }

    // Check if the chats table is missing the new columns
    if (!sqliteTableExists('chats')) {
      return false;
    }

    const columns = getSQLiteTableColumns('chats');
    const columnNames = columns.map((col) => col.name);

    return !columnNames.includes('isDangerousChat');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      if (sqliteTableExists('chats')) {
        const chatColumns = getSQLiteTableColumns('chats');
        const chatColumnNames = chatColumns.map((col) => col.name);

        if (!chatColumnNames.includes('isDangerousChat')) {
          db.exec(`ALTER TABLE "chats" ADD COLUMN "isDangerousChat" INTEGER DEFAULT NULL`);
          columnsAdded++;
          logger.info('Added isDangerousChat column to chats table', {
            context: 'migration.add-chat-danger-classification-fields',
          });
        }

        if (!chatColumnNames.includes('dangerScore')) {
          db.exec(`ALTER TABLE "chats" ADD COLUMN "dangerScore" REAL DEFAULT NULL`);
          columnsAdded++;
          logger.info('Added dangerScore column to chats table', {
            context: 'migration.add-chat-danger-classification-fields',
          });
        }

        if (!chatColumnNames.includes('dangerCategories')) {
          db.exec(`ALTER TABLE "chats" ADD COLUMN "dangerCategories" TEXT DEFAULT '[]'`);
          columnsAdded++;
          logger.info('Added dangerCategories column to chats table', {
            context: 'migration.add-chat-danger-classification-fields',
          });
        }

        if (!chatColumnNames.includes('dangerClassifiedAt')) {
          db.exec(`ALTER TABLE "chats" ADD COLUMN "dangerClassifiedAt" TEXT DEFAULT NULL`);
          columnsAdded++;
          logger.info('Added dangerClassifiedAt column to chats table', {
            context: 'migration.add-chat-danger-classification-fields',
          });
        }

        if (!chatColumnNames.includes('dangerClassifiedAtMessageCount')) {
          db.exec(`ALTER TABLE "chats" ADD COLUMN "dangerClassifiedAtMessageCount" INTEGER DEFAULT NULL`);
          columnsAdded++;
          logger.info('Added dangerClassifiedAtMessageCount column to chats table', {
            context: 'migration.add-chat-danger-classification-fields',
          });
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('Added chat danger classification fields to chats table', {
        context: 'migration.add-chat-danger-classification-fields',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-chat-danger-classification-fields-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} chat danger classification column(s) to chats table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add chat danger classification fields', {
        context: 'migration.add-chat-danger-classification-fields',
        error: errorMessage,
      });

      return {
        id: 'add-chat-danger-classification-fields-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add chat danger classification fields',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
