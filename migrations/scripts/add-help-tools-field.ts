/**
 * Migration: Add Help Tools Field
 *
 * Adds defaultHelpToolsEnabled field to the characters table.
 * This controls whether help tools (help_search, help_settings) are
 * available when chatting with this character.
 *
 * NULL = inherit from global (default: disabled), 0 = disabled, 1 = enabled
 *
 * Migration ID: add-help-tools-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addHelpToolsFieldMigration: Migration = {
  id: 'add-help-tools-field-v1',
  description: 'Add defaultHelpToolsEnabled field to characters table',
  introducedInVersion: '2.14.0',
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
    return !columnNames.includes('defaultHelpToolsEnabled');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      // NULL = inherit from global (default disabled), 0 = disabled, 1 = enabled
      db.exec(`ALTER TABLE "characters" ADD COLUMN "defaultHelpToolsEnabled" INTEGER DEFAULT NULL`);

      const durationMs = Date.now() - startTime;

      logger.info('Added defaultHelpToolsEnabled column to characters table', {
        context: 'migration.add-help-tools-field',
        durationMs,
      });

      return {
        id: 'add-help-tools-field-v1',
        success: true,
        itemsAffected: 1,
        message: 'Added defaultHelpToolsEnabled column to characters table',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add help tools field', {
        context: 'migration.add-help-tools-field',
        error: errorMessage,
      });

      return {
        id: 'add-help-tools-field-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to add help tools field',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
