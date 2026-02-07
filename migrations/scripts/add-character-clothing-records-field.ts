/**
 * Migration: Add Character Clothing Records Field
 *
 * Adds a clothingRecords field to the characters table so characters can have
 * outfit descriptions for system prompts and image generation.
 * Stored as JSON TEXT array, default empty array.
 *
 * Migration ID: add-character-clothing-records-field-v1
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
 * Add Character Clothing Records Field Migration
 */
export const addCharacterClothingRecordsFieldMigration: Migration = {
  id: 'add-character-clothing-records-field-v1',
  description: 'Add clothingRecords field to characters table',
  introducedInVersion: '2.10.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('characters')) {
      return false;
    }

    const columns = getSQLiteTableColumns('characters');
    const columnNames = columns.map((col) => col.name);

    return !columnNames.includes('clothingRecords');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      if (sqliteTableExists('characters')) {
        const columns = getSQLiteTableColumns('characters');
        const columnNames = columns.map((col) => col.name);

        if (!columnNames.includes('clothingRecords')) {
          db.exec(`ALTER TABLE "characters" ADD COLUMN "clothingRecords" TEXT DEFAULT '[]'`);
          columnsAdded++;
          logger.info('Added clothingRecords column to characters table', {
            context: 'migration.add-character-clothing-records-field',
          });
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('Character clothing records field migration completed', {
        context: 'migration.add-character-clothing-records-field',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-character-clothing-records-field-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} column(s) to characters table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add character clothing records field', {
        context: 'migration.add-character-clothing-records-field',
        error: errorMessage,
      });

      return {
        id: 'add-character-clothing-records-field-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add character clothing records field',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
