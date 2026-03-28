/**
 * Migration: Add Default Scenario/SystemPrompt ID Fields to Characters
 *
 * Adds defaultScenarioId and defaultSystemPromptId columns to the characters table.
 * These columns store UUIDs referencing a character's preferred default scenario
 * and system prompt for new chat creation.
 *
 * Migration ID: add-character-default-ids-fields-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addCharacterDefaultIdsFieldsMigration: Migration = {
  id: 'add-character-default-ids-fields-v1',
  description: 'Add defaultScenarioId and defaultSystemPromptId columns to characters for per-character defaults',
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

    return !columnNames.includes('defaultScenarioId') || !columnNames.includes('defaultSystemPromptId');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();
      const columns = getSQLiteTableColumns('characters');
      const columnNames = columns.map((col) => col.name);
      let columnsAdded = 0;

      if (!columnNames.includes('defaultScenarioId')) {
        db.exec(`ALTER TABLE "characters" ADD COLUMN "defaultScenarioId" TEXT DEFAULT NULL`);
        columnsAdded++;
        logger.info('Added defaultScenarioId column to characters table', {
          context: 'migration.add-character-default-ids-fields',
        });
      }

      if (!columnNames.includes('defaultSystemPromptId')) {
        db.exec(`ALTER TABLE "characters" ADD COLUMN "defaultSystemPromptId" TEXT DEFAULT NULL`);
        columnsAdded++;
        logger.info('Added defaultSystemPromptId column to characters table', {
          context: 'migration.add-character-default-ids-fields',
        });
      }

      const durationMs = Date.now() - startTime;

      return {
        id: 'add-character-default-ids-fields-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} column(s) to characters table (defaultScenarioId, defaultSystemPromptId)`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add default ID columns to characters', {
        context: 'migration.add-character-default-ids-fields',
        error: errorMessage,
      });

      return {
        id: 'add-character-default-ids-fields-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to add default ID columns to characters',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
