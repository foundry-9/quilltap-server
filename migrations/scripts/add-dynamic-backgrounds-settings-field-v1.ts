/**
 * Migration: Add dynamicBackgrounds Field to Chat Settings
 *
 * Adds a dynamicBackgrounds TEXT (JSON) column to chat_settings: the
 * instance-wide switch, uncensored allowance and refresh interval for the
 * collage painted behind the home, project and character pages (Settings →
 * Appearance → Dynamic Backgrounds). `chat_settings` is column-per-field, so
 * a new settings object needs its own column.
 *
 * Migration ID: add-dynamic-backgrounds-settings-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
} from '../lib/database-utils';

const MIGRATION_ID = 'add-dynamic-backgrounds-settings-field-v1';

/**
 * Column default. Must match `DynamicBackgroundsSettingsSchema`'s defaults in
 * `lib/schemas/settings.types.ts` and the repository's `defaultChatSettings`.
 */
const DEFAULT_DYNAMIC_BACKGROUNDS = JSON.stringify({
  enabled: false,
  allowUncensored: false,
  refreshMinutes: 3,
});

export const addDynamicBackgroundsSettingsFieldMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Add dynamicBackgrounds field to chat_settings table for the page-background collage',
  introducedInVersion: '4.14.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }
    if (!sqliteTableExists('chat_settings')) {
      return false;
    }
    return !sqliteColumnExists('chat_settings', 'dynamicBackgrounds');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      if (
        addColumnIfMissing(
          'chat_settings',
          'dynamicBackgrounds',
          `TEXT DEFAULT '${DEFAULT_DYNAMIC_BACKGROUNDS}'`
        )
      ) {
        columnsAdded++;
        logger.info('Added dynamicBackgrounds column to chat_settings table', {
          context: 'migration.add-dynamic-backgrounds-settings-field',
        });
      }

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: columnsAdded,
        message: 'Added dynamicBackgrounds column to chat_settings table',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to add dynamicBackgrounds column', {
        context: 'migration.add-dynamic-backgrounds-settings-field',
        error: errorMessage,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add dynamicBackgrounds column',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
