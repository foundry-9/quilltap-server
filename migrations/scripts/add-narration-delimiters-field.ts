/**
 * Migration: Add Narration Delimiters Field
 *
 * Adds the narrationDelimiters column to roleplay_templates table.
 * This column stores the narration delimiter(s) as a JSON value —
 * either a single string (e.g., '"*"') or a two-element array (e.g., '["[","]"]').
 * Defaults to '"*"' (single asterisk) for existing rows.
 *
 * Migration ID: add-narration-delimiters-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addNarrationDelimitersFieldMigration: Migration = {
  id: 'add-narration-delimiters-field-v1',
  description: 'Add narrationDelimiters column to roleplay_templates for semantic narration detection',
  introducedInVersion: '4.2.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('roleplay_templates')) {
      return false;
    }

    const columns = getSQLiteTableColumns('roleplay_templates');
    const columnNames = columns.map((col) => col.name);

    return !columnNames.includes('narrationDelimiters');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      // Add column with default of '*' (JSON-encoded string)
      db.exec(`ALTER TABLE "roleplay_templates" ADD COLUMN "narrationDelimiters" TEXT DEFAULT '"*"'`);

      // Backfill existing rows that got NULL (shouldn't happen with DEFAULT, but be safe)
      db.exec(`UPDATE "roleplay_templates" SET "narrationDelimiters" = '"*"' WHERE "narrationDelimiters" IS NULL`);

      logger.info('Added narrationDelimiters column to roleplay_templates table', {
        context: 'migration.add-narration-delimiters-field',
      });

      const durationMs = Date.now() - startTime;

      return {
        id: 'add-narration-delimiters-field-v1',
        success: true,
        itemsAffected: 1,
        message: 'Added narrationDelimiters column to roleplay_templates',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add narrationDelimiters column', {
        context: 'migration.add-narration-delimiters-field',
        error: errorMessage,
      });

      return {
        id: 'add-narration-delimiters-field-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to add narrationDelimiters column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
