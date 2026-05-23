/**
 * Migration: Add textReplacementsEnabled Field to Chat Settings
 *
 * Adds a textReplacementsEnabled INTEGER field to the chat_settings table.
 * When enabled (the default), the Lexical TextReplacementPlugin fires
 * user-defined word-boundary replacements in the Salon composer and the
 * Document Mode rich editor. Source-mode editors remain unaffected.
 *
 * Companion to add-text-replacement-rules-table-v1 (Layer 1.5 master toggle).
 *
 * Migration ID: add-text-replacements-enabled-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addTextReplacementsEnabledFieldMigration: Migration = {
  id: 'add-text-replacements-enabled-field-v1',
  description: 'Add textReplacementsEnabled field to chat_settings table for the text-replacement master toggle',
  introducedInVersion: '4.6.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chat_settings')) {
      return false;
    }

    const columns = getSQLiteTableColumns('chat_settings');
    const columnNames = columns.map((col) => col.name);

    return !columnNames.includes('textReplacementsEnabled');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      const columns = getSQLiteTableColumns('chat_settings');
      const columnNames = columns.map((col) => col.name);

      if (!columnNames.includes('textReplacementsEnabled')) {
        db.exec(`ALTER TABLE "chat_settings" ADD COLUMN "textReplacementsEnabled" INTEGER DEFAULT 1`);
        columnsAdded++;
        logger.info('Added textReplacementsEnabled column to chat_settings table', {
          context: 'migration.add-text-replacements-enabled-field',
        });
      }

      const durationMs = Date.now() - startTime;

      return {
        id: 'add-text-replacements-enabled-field-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added textReplacementsEnabled column to chat_settings table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add textReplacementsEnabled column', {
        context: 'migration.add-text-replacements-enabled-field',
        error: errorMessage,
      });

      return {
        id: 'add-text-replacements-enabled-field-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add textReplacementsEnabled column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
