/**
 * Migration: Add Calliope Theme Draft Field
 *
 * Adds one nullable column to the chats table, meaningful only for Calliope's
 * conversations (`chatType = 'calliope'`, Calliope Live Spec J decision 9):
 *
 * - `themeDraftId` — the theme draft the conversation belongs to (the draft's
 *   folder name under `Themes/` in Quilltap General). Set at creation and never
 *   changed; the conversation is deleted with its draft.
 *
 * Pure `ALTER TABLE`, idempotent: each column is added only when missing.
 *
 * Migration ID: add-calliope-theme-draft-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
} from '../lib/database-utils';

const MIGRATION_ID = 'add-calliope-theme-draft-field-v1';
const COLUMNS = ['themeDraftId'] as const;

function missingColumns(): string[] {
  return COLUMNS.filter((name) => !sqliteColumnExists('chats', name));
}

export const addCalliopeThemeDraftFieldMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Add themeDraftId field to chats table (Calliope theme conversations)',
  introducedInVersion: '4.14.0',
  dependsOn: ['add-console-writing-assistant-fields-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chats')) {
      return false;
    }

    return missingColumns().length > 0;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const missing = COLUMNS.filter((column) => addColumnIfMissing('chats', column, 'TEXT DEFAULT NULL'));

      const durationMs = Date.now() - startTime;

      logger.info('Added the Calliope theme draft column to chats table', {
        context: `migration.${MIGRATION_ID}`,
        columns: missing,
        durationMs,
      });

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: missing.length,
        message: `Added ${missing.join(', ') || 'no'} column(s) to chats table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add the Calliope theme draft field', {
        context: `migration.${MIGRATION_ID}`,
        error: errorMessage,
      });

      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to add the Calliope theme draft field',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
