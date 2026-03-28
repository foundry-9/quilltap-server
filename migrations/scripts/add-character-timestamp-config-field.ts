/**
 * Migration: Add Default Timestamp Config Field to Characters
 *
 * Adds the defaultTimestampConfig column to the characters table.
 * This column stores a JSON object with per-character default timestamp
 * injection settings that propagate to new chat dialogs.
 *
 * Migration ID: add-character-timestamp-config-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addCharacterTimestampConfigFieldMigration: Migration = {
  id: 'add-character-timestamp-config-field-v1',
  description: 'Add defaultTimestampConfig column to characters for per-character timestamp defaults',
  introducedInVersion: '3.3.0',
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

    return !columnNames.includes('defaultTimestampConfig');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      db.exec(`ALTER TABLE "characters" ADD COLUMN "defaultTimestampConfig" TEXT DEFAULT NULL`);

      logger.info('Added defaultTimestampConfig column to characters table', {
        context: 'migration.add-character-timestamp-config-field',
      });

      const durationMs = Date.now() - startTime;

      return {
        id: 'add-character-timestamp-config-field-v1',
        success: true,
        itemsAffected: 1,
        message: 'Added defaultTimestampConfig column to characters',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add defaultTimestampConfig column', {
        context: 'migration.add-character-timestamp-config-field',
        error: errorMessage,
      });

      return {
        id: 'add-character-timestamp-config-field-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to add defaultTimestampConfig column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
