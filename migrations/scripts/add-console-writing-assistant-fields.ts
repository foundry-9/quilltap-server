/**
 * Migration: Add Console Writing Assistant Fields
 *
 * Adds two nullable columns to the chats table, both meaningful only for
 * Brahma Console chats (`chatType = 'brahma'`):
 *
 * - `consoleMode` — `'writing'` for a Writing Assistant conversation, NULL for
 *   the ordinary Console. Set at creation and never changed.
 * - `consoleContext` — JSON array of the sources the operator named for the
 *   piece (`ConsoleContextRef[]`); NULL or `[]` means none.
 *
 * Pure `ALTER TABLE`, idempotent: each column is added only when missing.
 *
 * Migration ID: add-console-writing-assistant-fields-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
} from '../lib/database-utils';

const MIGRATION_ID = 'add-console-writing-assistant-fields-v1';
const COLUMNS = ['consoleMode', 'consoleContext'] as const;

function missingColumns(): string[] {
  return COLUMNS.filter((name) => !sqliteColumnExists('chats', name));
}

export const addConsoleWritingAssistantFieldsMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Add consoleMode and consoleContext fields to chats table (Brahma Console Writing Assistant)',
  introducedInVersion: '4.13.0',
  dependsOn: ['add-console-connection-profile-field-v1'],

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

      logger.info('Added Console Writing Assistant columns to chats table', {
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

      logger.error('Failed to add Console Writing Assistant fields', {
        context: `migration.${MIGRATION_ID}`,
        error: errorMessage,
      });

      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to add Console Writing Assistant fields',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
