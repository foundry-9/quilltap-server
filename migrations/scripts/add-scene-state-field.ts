/**
 * Migration: Add Scene State Field
 *
 * This migration adds scene state tracking field to the chats table:
 * - sceneState (TEXT, nullable) - Scene state information for tracking context
 *
 * This field supports scene state tracking functionality in chats.
 *
 * Migration ID: add-scene-state-field-v1
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
 * Add Scene State Field Migration
 */
export const addSceneStateFieldMigration: Migration = {
  id: 'add-scene-state-field-v1',
  description: 'Add scene state tracking field to chats table',
  introducedInVersion: '3.4.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    // Only run for SQLite backend
    if (!isSQLiteBackend()) {
      return false;
    }

    // Check if the chats table is missing the sceneState column
    if (!sqliteTableExists('chats')) {
      return false;
    }

    const columns = getSQLiteTableColumns('chats');
    const columnNames = columns.map((col) => col.name);

    return !columnNames.includes('sceneState');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      if (sqliteTableExists('chats')) {
        const chatColumns = getSQLiteTableColumns('chats');
        const chatColumnNames = chatColumns.map((col) => col.name);

        if (!chatColumnNames.includes('sceneState')) {
          db.exec(`ALTER TABLE "chats" ADD COLUMN "sceneState" TEXT DEFAULT NULL`);
          columnsAdded++;
          logger.info('Added sceneState column to chats table', {
            context: 'migration.add-scene-state-field',
          });
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('Added scene state field to chats table', {
        context: 'migration.add-scene-state-field',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-scene-state-field-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} scene state column(s) to chats table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add scene state field', {
        context: 'migration.add-scene-state-field',
        error: errorMessage,
      });

      return {
        id: 'add-scene-state-field-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add scene state field',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
