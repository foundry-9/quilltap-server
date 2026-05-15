/**
 * Migration: Add uncensoredImageDescriptionProfileId Field to chat_settings
 *
 * Phase 2 photo support: when the primary image-description profile refuses
 * to describe an attached image (or returns an empty/error response), the
 * uploader falls back to the profile configured here. The migration adds a
 * single nullable TEXT column to `chat_settings` — no row iteration.
 *
 * Migration ID: add-uncensored-image-description-profile-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addUncensoredImageDescriptionProfileFieldMigration: Migration = {
  id: 'add-uncensored-image-description-profile-field-v1',
  description: 'Add uncensoredImageDescriptionProfileId field to chat_settings table',
  introducedInVersion: '2.9.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('chat_settings')) return false;

    const columns = getSQLiteTableColumns('chat_settings');
    const hasColumn = columns.some((col) => col.name === 'uncensoredImageDescriptionProfileId');
    return !hasColumn;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();
      db.exec(`ALTER TABLE "chat_settings" ADD COLUMN "uncensoredImageDescriptionProfileId" TEXT`);

      const durationMs = Date.now() - startTime;
      logger.info('Added uncensoredImageDescriptionProfileId column to chat_settings table', {
        context: 'migration.add-uncensored-image-description-profile-field',
        durationMs,
      });

      return {
        id: 'add-uncensored-image-description-profile-field-v1',
        success: true,
        itemsAffected: 1,
        message: 'Added uncensoredImageDescriptionProfileId column to chat_settings table',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add uncensoredImageDescriptionProfileId column', {
        context: 'migration.add-uncensored-image-description-profile-field',
        error: errorMessage,
      });

      return {
        id: 'add-uncensored-image-description-profile-field-v1',
        success: false,
        itemsAffected: 0,
        message: `Failed: ${errorMessage}`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
