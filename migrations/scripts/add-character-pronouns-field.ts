/**
 * Migration: Add Character Pronouns Field
 *
 * Adds a pronouns field to the characters table so characters can have
 * specified pronouns (e.g., he/him/his, she/her/her, they/them/their).
 * Stored as JSON TEXT, nullable (null = not set).
 *
 * Migration ID: add-character-pronouns-field-v1
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
 * Add Character Pronouns Field Migration
 */
export const addCharacterPronounsFieldMigration: Migration = {
  id: 'add-character-pronouns-field-v1',
  description: 'Add pronouns field to characters table',
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

    return !columnNames.includes('pronouns');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      if (sqliteTableExists('characters')) {
        const columns = getSQLiteTableColumns('characters');
        const columnNames = columns.map((col) => col.name);

        if (!columnNames.includes('pronouns')) {
          db.exec(`ALTER TABLE "characters" ADD COLUMN "pronouns" TEXT DEFAULT NULL`);
          columnsAdded++;
          logger.info('Added pronouns column to characters table', {
            context: 'migration.add-character-pronouns-field',
          });
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('Character pronouns field migration completed', {
        context: 'migration.add-character-pronouns-field',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-character-pronouns-field-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} column(s) to characters table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add character pronouns field', {
        context: 'migration.add-character-pronouns-field',
        error: errorMessage,
      });

      return {
        id: 'add-character-pronouns-field-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add character pronouns field',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
