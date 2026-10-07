/**
 * Migration: Add wardrobeImageSettings Field to Chat Settings
 *
 * Adds a wardrobeImageSettings TEXT (JSON) column to chat_settings: the image
 * profile designated for drawing wardrobe items' pictures (Settings → Images →
 * Wardrobe Images). `chat_settings` is column-per-field, so a new settings
 * object needs its own column even though the schema field is optional.
 *
 * Migration ID: add-wardrobe-image-settings-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
} from '../lib/database-utils';

const MIGRATION_ID = 'add-wardrobe-image-settings-field-v1';

/**
 * Column default. Must match `WardrobeImageSettingsSchema`'s defaults in
 * `lib/schemas/settings.types.ts` and the repository's `updateForUser` seed.
 */
const DEFAULT_WARDROBE_IMAGE_SETTINGS = JSON.stringify({ imageProfileId: null });

export const addWardrobeImageSettingsFieldMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Add wardrobeImageSettings field to chat_settings table for the wardrobe-picture image profile',
  introducedInVersion: '4.10.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }
    if (!sqliteTableExists('chat_settings')) {
      return false;
    }
    return !sqliteColumnExists('chat_settings', 'wardrobeImageSettings');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      if (
        addColumnIfMissing(
          'chat_settings',
          'wardrobeImageSettings',
          `TEXT DEFAULT '${DEFAULT_WARDROBE_IMAGE_SETTINGS}'`
        )
      ) {
        columnsAdded++;
        logger.info('Added wardrobeImageSettings column to chat_settings table', {
          context: 'migration.add-wardrobe-image-settings-field',
        });
      }

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: columnsAdded,
        message: 'Added wardrobeImageSettings column to chat_settings table',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to add wardrobeImageSettings column', {
        context: 'migration.add-wardrobe-image-settings-field',
        error: errorMessage,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add wardrobeImageSettings column',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
