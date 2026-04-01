/**
 * Migration: Add Character Aliases Field
 *
 * Adds an aliases field to the characters table so characters can have
 * alternate names (e.g., "Elizabeth" also goes by "Liz", "Lizzy").
 *
 * Migration ID: add-character-aliases-field-v1
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
 * Add Character Aliases Field Migration
 */
export const addCharacterAliasesFieldMigration: Migration = {
  id: 'add-character-aliases-field-v1',
  description: 'Add aliases field to characters table',
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

    return !columnNames.includes('aliases');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      if (sqliteTableExists('characters')) {
        const columns = getSQLiteTableColumns('characters');
        const columnNames = columns.map((col) => col.name);

        if (!columnNames.includes('aliases')) {
          db.exec(`ALTER TABLE "characters" ADD COLUMN "aliases" TEXT DEFAULT '[]'`);
          columnsAdded++;
          logger.info('Added aliases column to characters table', {
            context: 'migration.add-character-aliases-field',
          });
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('Character aliases field migration completed', {
        context: 'migration.add-character-aliases-field',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-character-aliases-field-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} column(s) to characters table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add character aliases field', {
        context: 'migration.add-character-aliases-field',
        error: errorMessage,
      });

      return {
        id: 'add-character-aliases-field-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add character aliases field',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
