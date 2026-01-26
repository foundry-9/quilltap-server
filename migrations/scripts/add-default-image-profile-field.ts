/**
 * Migration: Add defaultImageProfileId Field to Characters
 *
 * This migration adds the defaultImageProfileId field to the characters table.
 * This allows characters to have a default image generation profile associated
 * with them, which is used when generating images during chats.
 *
 * Migration ID: add-default-image-profile-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

/**
 * Add defaultImageProfileId Field Migration
 */
export const addDefaultImageProfileFieldMigration: Migration = {
  id: 'add-default-image-profile-field-v1',
  description: 'Add defaultImageProfileId field to characters table',
  introducedInVersion: '2.8.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    // Only run for SQLite backend
    if (!isSQLiteBackend()) {
      return false;
    }

    // Check if characters table exists
    if (!sqliteTableExists('characters')) {
      logger.debug('Characters table does not exist, skipping migration', {
        context: 'migration.add-default-image-profile-field',
      });
      return false;
    }

    // Check if the column already exists
    const columns = getSQLiteTableColumns('characters');
    const hasColumn = columns.some((col) => col.name === 'defaultImageProfileId');

    if (hasColumn) {
      logger.debug('defaultImageProfileId column already exists', {
        context: 'migration.add-default-image-profile-field',
      });
      return false;
    }

    return true;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      // Add the column
      db.exec(`ALTER TABLE "characters" ADD COLUMN "defaultImageProfileId" TEXT`);

      const durationMs = Date.now() - startTime;

      logger.info('Added defaultImageProfileId column to characters table', {
        context: 'migration.add-default-image-profile-field',
        durationMs,
      });

      return {
        id: 'add-default-image-profile-field-v1',
        success: true,
        itemsAffected: 1,
        message: 'Added defaultImageProfileId column to characters table',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add defaultImageProfileId column', {
        context: 'migration.add-default-image-profile-field',
        error: errorMessage,
      });

      return {
        id: 'add-default-image-profile-field-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to add defaultImageProfileId column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
