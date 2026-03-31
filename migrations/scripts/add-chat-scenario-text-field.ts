/**
 * Migration: Add Chat Scenario Text Field
 *
 * This migration adds a scenarioText field to the chats table:
 * - scenarioText (TEXT, nullable) - Persists the selected scenario content for the chat
 *
 * This field supports persisting the selected scenario content in chats.
 *
 * Migration ID: add-chat-scenario-text-field-v1
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
 * Add Chat Scenario Text Field Migration
 */
export const addChatScenarioTextFieldMigration: Migration = {
  id: 'add-chat-scenario-text-field-v1',
  description: 'Add scenarioText field to chats table to persist selected scenario content',
  introducedInVersion: '4.1.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    // Only run for SQLite backend
    if (!isSQLiteBackend()) {
      return false;
    }

    // Check if the chats table is missing the scenarioText column
    if (!sqliteTableExists('chats')) {
      return false;
    }

    const columns = getSQLiteTableColumns('chats');
    const columnNames = columns.map((col) => col.name);

    return !columnNames.includes('scenarioText');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      if (sqliteTableExists('chats')) {
        const chatColumns = getSQLiteTableColumns('chats');
        const chatColumnNames = chatColumns.map((col) => col.name);

        if (!chatColumnNames.includes('scenarioText')) {
          db.exec(`ALTER TABLE "chats" ADD COLUMN "scenarioText" TEXT DEFAULT NULL`);
          columnsAdded++;
          logger.info('Added scenarioText column to chats table', {
            context: 'migration.add-chat-scenario-text-field',
          });
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('Added scenarioText field to chats table', {
        context: 'migration.add-chat-scenario-text-field',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-chat-scenario-text-field-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} scenarioText column(s) to chats table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add scenarioText field', {
        context: 'migration.add-chat-scenario-text-field',
        error: errorMessage,
      });

      return {
        id: 'add-chat-scenario-text-field-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add scenarioText field',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
