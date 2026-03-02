/**
 * Migration: Add sortIndex Field to Connection Profiles
 *
 * This migration adds the sortIndex INTEGER column to connection_profiles.
 * Profiles are initialized with a smart default order:
 *   - Default profile gets sortIndex 0
 *   - Cheap profiles get high sort indices (pushed toward end)
 *   - Everything else sorts alphabetically in between
 *
 * Migration ID: add-connection-profile-sort-index-v1
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
 * Add sortIndex Field Migration
 */
export const addConnectionProfileSortIndexMigration: Migration = {
  id: 'add-connection-profile-sort-index-v1',
  description: 'Add sortIndex field to connection profiles for custom ordering',
  introducedInVersion: '3.2.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('connection_profiles')) {
      return false;
    }

    const columns = getSQLiteTableColumns('connection_profiles');
    const hasColumn = columns.some((col) => col.name === 'sortIndex');
    return !hasColumn;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      // Add the column with default 0
      db.exec('ALTER TABLE "connection_profiles" ADD COLUMN "sortIndex" INTEGER DEFAULT 0');

      // Verify column was added
      const columns = getSQLiteTableColumns('connection_profiles');
      const hasColumn = columns.some((col) => col.name === 'sortIndex');

      if (!hasColumn) {
        throw new Error('Column was not added successfully');
      }

      // Initialize existing profiles with smart ordering:
      // Default first (0), then non-cheap alphabetically, then cheap alphabetically
      const profiles = db.prepare(
        'SELECT id, name, isDefault, isCheap FROM connection_profiles ORDER BY name COLLATE NOCASE ASC'
      ).all() as Array<{ id: string; name: string; isDefault: number; isCheap: number }>;

      if (profiles.length > 0) {
        const updateStmt = db.prepare('UPDATE connection_profiles SET "sortIndex" = ? WHERE id = ?');

        let sortIndex = 0;

        // Default profile first
        const defaultProfile = profiles.find((p) => p.isDefault === 1);
        if (defaultProfile) {
          updateStmt.run(sortIndex++, defaultProfile.id);
        }

        // Non-cheap, non-default profiles next (already sorted alphabetically)
        for (const profile of profiles) {
          if (profile.isDefault === 1) continue;
          if (profile.isCheap === 1) continue;
          updateStmt.run(sortIndex++, profile.id);
        }

        // Cheap profiles last (already sorted alphabetically)
        for (const profile of profiles) {
          if (profile.isDefault === 1) continue;
          if (profile.isCheap !== 1) continue;
          updateStmt.run(sortIndex++, profile.id);
        }
      }

      logger.info('Added sortIndex column to connection_profiles and initialized ordering', {
        context: 'migration.add-connection-profile-sort-index',
        profileCount: profiles.length,
      });

      return {
        id: 'add-connection-profile-sort-index-v1',
        success: true,
        itemsAffected: profiles.length,
        message: `Added sortIndex column to connection_profiles table and initialized ${profiles.length} profiles`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Failed to add sortIndex column', {
        context: 'migration.add-connection-profile-sort-index',
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        id: 'add-connection-profile-sort-index-v1',
        success: false,
        itemsAffected: 0,
        message: `Failed to add sortIndex column: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
