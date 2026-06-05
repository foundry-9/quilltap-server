/**
 * Migration: Add composerSpellcheck Field to Chat Settings
 *
 * This migration adds a composerSpellcheck INTEGER field to the chat_settings table.
 * When enabled (the default), browser spellcheck runs on the Salon ChatComposer and
 * the Document Mode rich editor. Source-mode editors remain unaffected.
 *
 * Migration ID: add-composer-spellcheck-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addComposerSpellcheckFieldMigration: Migration = {
  id: 'add-composer-spellcheck-field-v1',
  description: 'Add composerSpellcheck field to chat_settings table for the composer spellcheck toggle',
  introducedInVersion: '4.4.0',
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

    return !columnNames.includes('composerSpellcheck');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      const columns = getSQLiteTableColumns('chat_settings');
      const columnNames = columns.map((col) => col.name);

      if (!columnNames.includes('composerSpellcheck')) {
        db.exec(`ALTER TABLE "chat_settings" ADD COLUMN "composerSpellcheck" INTEGER DEFAULT 1`);
        columnsAdded++;
        logger.info('Added composerSpellcheck column to chat_settings table', {
          context: 'migration.add-composer-spellcheck-field',
        });
      }

      const durationMs = Date.now() - startTime;

      return {
        id: 'add-composer-spellcheck-field-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added composerSpellcheck column to chat_settings table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add composerSpellcheck column', {
        context: 'migration.add-composer-spellcheck-field',
        error: errorMessage,
      });

      return {
        id: 'add-composer-spellcheck-field-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add composerSpellcheck column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
