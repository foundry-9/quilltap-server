/**
 * Migration: Add composerSlashCommands Field to Chat Settings
 *
 * This migration adds a composerSlashCommands INTEGER field to the chat_settings
 * table. When enabled (the default), typing `/` at the start of a word in the
 * Salon composer opens the slash-command menu (composer actions, Prospero's
 * tools, Pascal's custom tools). The gutter buttons and the sidebar's Run Tool
 * are deliberately NOT gated by this flag — an explicit button press is never
 * a surprise.
 *
 * Migration ID: add-composer-slash-commands-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
} from '../lib/database-utils';

export const addComposerSlashCommandsFieldMigration: Migration = {
  id: 'add-composer-slash-commands-field-v1',
  description:
    'Add composerSlashCommands field to chat_settings table for the composer slash-command typeahead toggle',
  introducedInVersion: '4.11.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chat_settings')) {
      return false;
    }

    return !sqliteColumnExists('chat_settings', 'composerSlashCommands');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      if (addColumnIfMissing('chat_settings', 'composerSlashCommands', 'INTEGER DEFAULT 1')) {
        columnsAdded++;
        logger.info('Added composerSlashCommands column to chat_settings table', {
          context: 'migration.add-composer-slash-commands-field',
        });
      }

      const durationMs = Date.now() - startTime;

      return {
        id: 'add-composer-slash-commands-field-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added composerSlashCommands column to chat_settings table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add composerSlashCommands column', {
        context: 'migration.add-composer-slash-commands-field',
        error: errorMessage,
      });

      return {
        id: 'add-composer-slash-commands-field-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add composerSlashCommands column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
