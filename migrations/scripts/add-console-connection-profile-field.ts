/**
 * Migration: Add Console Connection Profile Field
 *
 * Adds the `consoleConnectionProfileId` column to the chats table. The Brahma
 * Console (chatType === 'brahma') stores its currently-selected connection
 * profile (model) here; a Brahma chat has exactly one model at a time, and
 * switching the model PATCHes this column so the same chat continues with the
 * new engine. NULL on every other chat type.
 *
 * Migration ID: add-console-connection-profile-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addConsoleConnectionProfileFieldMigration: Migration = {
  id: 'add-console-connection-profile-field-v1',
  description: 'Add consoleConnectionProfileId field to chats table (Brahma Console model selection)',
  introducedInVersion: '4.7.0',
  dependsOn: ['add-chat-type-field-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chats')) {
      return false;
    }

    const columns = getSQLiteTableColumns('chats');
    const columnNames = columns.map((col) => col.name);
    return !columnNames.includes('consoleConnectionProfileId');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      db.exec(`ALTER TABLE "chats" ADD COLUMN "consoleConnectionProfileId" TEXT DEFAULT NULL`);

      const durationMs = Date.now() - startTime;

      logger.info('Added consoleConnectionProfileId column to chats table', {
        context: 'migration.add-console-connection-profile-field',
        durationMs,
      });

      return {
        id: 'add-console-connection-profile-field-v1',
        success: true,
        itemsAffected: 1,
        message: 'Added consoleConnectionProfileId column to chats table',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add consoleConnectionProfileId field', {
        context: 'migration.add-console-connection-profile-field',
        error: errorMessage,
      });

      return {
        id: 'add-console-connection-profile-field-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to add consoleConnectionProfileId field',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
