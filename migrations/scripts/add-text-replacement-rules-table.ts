/**
 * Migration: Add Text Replacement Rules Table
 *
 * Creates the text_replacement_rules table for user-defined word-boundary text
 * replacements (Layer 1.5 of the composer spellcheck/autocorrect plan).
 *
 * Rules are global per instance (no userId, single-user model). The renderer
 * compiles them into case-sensitive and case-insensitive lookup maps for the
 * Lexical TextReplacementPlugin.
 *
 * Migration ID: add-text-replacement-rules-table-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';

export const addTextReplacementRulesTableMigration: Migration = {
  id: 'add-text-replacement-rules-table-v1',
  description: 'Create text_replacement_rules table for composer text-replacement rules',
  introducedInVersion: '4.6.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    return !sqliteTableExists('text_replacement_rules');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      db.exec(
        `CREATE TABLE IF NOT EXISTS "text_replacement_rules" (
          "id" TEXT PRIMARY KEY,
          "fromText" TEXT NOT NULL,
          "toText" TEXT NOT NULL,
          "caseSensitive" INTEGER NOT NULL DEFAULT 0,
          "enabled" INTEGER NOT NULL DEFAULT 1,
          "sortOrder" INTEGER NOT NULL DEFAULT 0,
          "createdAt" TEXT NOT NULL,
          "updatedAt" TEXT NOT NULL
        )`
      );

      db.exec(
        `CREATE INDEX IF NOT EXISTS "idx_text_replacement_rules_enabled" ON "text_replacement_rules" ("enabled")`
      );

      db.exec(
        `CREATE INDEX IF NOT EXISTS "idx_text_replacement_rules_sortOrder" ON "text_replacement_rules" ("sortOrder")`
      );

      logger.info('Created text_replacement_rules table', {
        context: 'migration.add-text-replacement-rules-table',
      });

      const durationMs = Date.now() - startTime;

      return {
        id: 'add-text-replacement-rules-table-v1',
        success: true,
        itemsAffected: 1,
        message: 'Created text_replacement_rules table',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to create text_replacement_rules table', {
        context: 'migration.add-text-replacement-rules-table',
        error: errorMessage,
      });

      return {
        id: 'add-text-replacement-rules-table-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to create text_replacement_rules table',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
