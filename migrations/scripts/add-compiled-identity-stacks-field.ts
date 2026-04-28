/**
 * Migration: Add Compiled Identity Stacks Field
 *
 * Adds a `compiledIdentityStacks` JSON column to the chats table for the
 * Phase H system-prompt precompile. The column stores a per-participant map
 * of cached character-identity stacks (preamble + base prompt + personality
 * + aliases + pronouns + physical descriptions + example dialogues, with
 * `{{user}}` / `{{scenario}}` / `{{persona}}` resolved at compile time). The
 * per-turn `buildSystemPrompt` reads from this map when present and falls
 * back to a fresh build when missing — so existing chats work without
 * backfill.
 *
 * Migration ID: add-compiled-identity-stacks-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addCompiledIdentityStacksFieldMigration: Migration = {
  id: 'add-compiled-identity-stacks-field-v1',
  description: 'Add compiledIdentityStacks JSON column to chats table',
  introducedInVersion: '4.4.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chats')) {
      return false;
    }

    const columns = getSQLiteTableColumns('chats');
    const columnNames = columns.map((col) => col.name);

    return !columnNames.includes('compiledIdentityStacks');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      if (sqliteTableExists('chats')) {
        const columns = getSQLiteTableColumns('chats');
        const columnNames = columns.map((col) => col.name);

        if (!columnNames.includes('compiledIdentityStacks')) {
          db.exec(`ALTER TABLE "chats" ADD COLUMN "compiledIdentityStacks" TEXT DEFAULT NULL`);
          columnsAdded++;
          logger.info('Added compiledIdentityStacks column to chats table', {
            context: 'migration.add-compiled-identity-stacks-field',
          });
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('Compiled identity stacks field migration completed', {
        context: 'migration.add-compiled-identity-stacks-field',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-compiled-identity-stacks-field-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} column(s) to chats table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add compiled identity stacks field', {
        context: 'migration.add-compiled-identity-stacks-field',
        error: errorMessage,
      });

      return {
        id: 'add-compiled-identity-stacks-field-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add compiled identity stacks field',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
