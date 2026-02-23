/**
 * Migration: Add allowToolUse Field to Connection Profiles
 *
 * This migration adds the allowToolUse boolean field to connection_profiles.
 * When set to false, no tools are sent to the LLM regardless of chat/project
 * tool settings. This acts as a master override for tool use at the profile level.
 *
 * Default is 1 (true) so existing profiles retain their current behavior.
 *
 * Migration ID: add-profile-allow-tool-use-field-v1
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
 * Add allowToolUse Field Migration
 */
export const addProfileAllowToolUseFieldMigration: Migration = {
  id: 'add-profile-allow-tool-use-field-v1',
  description: 'Add allowToolUse field to connection profiles for master tool use override',
  introducedInVersion: '3.0.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('connection_profiles')) {
      return false;
    }

    const columns = getSQLiteTableColumns('connection_profiles');
    const hasColumn = columns.some((col) => col.name === 'allowToolUse');
    return !hasColumn;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();
      db.exec('ALTER TABLE "connection_profiles" ADD COLUMN "allowToolUse" INTEGER DEFAULT 1');

      // Verify
      const columns = getSQLiteTableColumns('connection_profiles');
      const hasColumn = columns.some((col) => col.name === 'allowToolUse');

      if (!hasColumn) {
        throw new Error('Column was not added successfully');
      }

      logger.info('Added allowToolUse column to connection_profiles', {
        context: 'migration.add-profile-allow-tool-use-field',
      });

      return {
        id: 'add-profile-allow-tool-use-field-v1',
        success: true,
        itemsAffected: 1,
        message: 'Added allowToolUse column to connection_profiles table',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Failed to add allowToolUse column', {
        context: 'migration.add-profile-allow-tool-use-field',
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        id: 'add-profile-allow-tool-use-field-v1',
        success: false,
        itemsAffected: 0,
        message: `Failed to add allowToolUse column: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
