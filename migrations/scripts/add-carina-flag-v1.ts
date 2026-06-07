/**
 * Migration: Add Carina Flag
 *
 * Adds the `canBeCarina` flag to the characters table. When set (1), the
 * character is eligible to answer inline `@Name:` / `@Name?` queries (and
 * `ask_carina` tool calls) as a Carina "answerer" — a minimal isolated
 * reference call with no chat history and no memory formation.
 *
 * NULL/0 = not an answerer, 1 = eligible.
 *
 * Migration ID: add-carina-flag-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addCarinaFlagMigration: Migration = {
  id: 'add-carina-flag-v1',
  description: 'Add canBeCarina flag to characters table',
  introducedInVersion: '4.7.0',
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
    return !columnNames.includes('canBeCarina');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      // NULL/0 = not a Carina answerer, 1 = eligible to answer @-queries
      db.exec(`ALTER TABLE "characters" ADD COLUMN "canBeCarina" INTEGER DEFAULT NULL`);

      const durationMs = Date.now() - startTime;

      logger.info('Added canBeCarina column to characters table', {
        context: 'migration.add-carina-flag',
        durationMs,
      });

      return {
        id: 'add-carina-flag-v1',
        success: true,
        itemsAffected: 1,
        message: 'Added canBeCarina column to characters table',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add canBeCarina field', {
        context: 'migration.add-carina-flag',
        error: errorMessage,
      });

      return {
        id: 'add-carina-flag-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to add canBeCarina field',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
