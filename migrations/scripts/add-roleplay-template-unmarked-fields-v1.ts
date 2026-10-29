/**
 * Migration: Add Unmarked-Text Fields to Roleplay Templates
 *
 * Adds two template-wide rendering columns to roleplay_templates:
 * - `unmarkedStyle` (TEXT, JSON `{ style, addOns? }` or NULL): how text that no
 *   delimiter claims is displayed — what lets narration be plain prose.
 * - `markdownAsterisks` (INTEGER, default 1): whether Markdown reads asterisks
 *   as bold/italic. 0 hands single `*` to the template's own delimiters.
 *
 * Existing rows keep today's behaviour (no unmarked style, Markdown asterisks
 * on). The built-in Novel template is seeded with both set by the repository.
 *
 * Migration ID: add-roleplay-template-unmarked-fields-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
} from '../lib/database-utils';

const MIGRATION_ID = 'add-roleplay-template-unmarked-fields-v1';

export const addRoleplayTemplateUnmarkedFieldsMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Add unmarkedStyle and markdownAsterisks columns to roleplay_templates (Novel template)',
  introducedInVersion: '4.11.0',
  dependsOn: ['add-narration-delimiters-field-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }
    if (!sqliteTableExists('roleplay_templates')) {
      return false;
    }
    return (
      !sqliteColumnExists('roleplay_templates', 'unmarkedStyle') ||
      !sqliteColumnExists('roleplay_templates', 'markdownAsterisks')
    );
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      if (addColumnIfMissing('roleplay_templates', 'unmarkedStyle', 'TEXT')) {
        columnsAdded++;
      }
      // SQLite uses INTEGER for boolean, 1 = true (Markdown keeps its asterisks)
      if (addColumnIfMissing('roleplay_templates', 'markdownAsterisks', 'INTEGER DEFAULT 1')) {
        columnsAdded++;
      }

      const durationMs = Date.now() - startTime;
      logger.info('Added unmarked-text columns to roleplay_templates table', {
        context: 'migration.add-roleplay-template-unmarked-fields',
        columnsAdded,
        durationMs,
      });

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} column(s) to roleplay_templates`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add unmarked-text columns to roleplay_templates', {
        context: 'migration.add-roleplay-template-unmarked-fields',
        error: errorMessage,
      });

      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add unmarked-text columns to roleplay_templates',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
