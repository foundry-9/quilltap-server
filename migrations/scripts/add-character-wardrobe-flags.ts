/**
 * Migration: Add Character Wardrobe Flags
 *
 * Adds canDressThemselves and canCreateOutfits flags to the characters table
 * so characters can have wardrobe autonomy settings.
 * Stored as INTEGER (boolean), default NULL.
 *
 * Migration ID: add-character-wardrobe-flags-v1
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
 * Add Character Wardrobe Flags Migration
 */
export const addCharacterWardrobeFlagsMigration: Migration = {
  id: 'add-character-wardrobe-flags-v1',
  description: 'Add canDressThemselves and canCreateOutfits flags to characters table',
  introducedInVersion: '4.3.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('characters')) {
      return false;
    }

    const columns = getSQLiteTableColumns('characters');
    const columnNames = columns.map((col) => col.name);

    return !columnNames.includes('canDressThemselves');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      if (sqliteTableExists('characters')) {
        const columns = getSQLiteTableColumns('characters');
        const columnNames = columns.map((col) => col.name);

        if (!columnNames.includes('canDressThemselves')) {
          db.exec(`ALTER TABLE "characters" ADD COLUMN "canDressThemselves" INTEGER DEFAULT NULL`);
          columnsAdded++;
          logger.info('Added canDressThemselves column to characters table', {
            context: 'migration.add-character-wardrobe-flags',
          });
        }

        if (!columnNames.includes('canCreateOutfits')) {
          db.exec(`ALTER TABLE "characters" ADD COLUMN "canCreateOutfits" INTEGER DEFAULT NULL`);
          columnsAdded++;
          logger.info('Added canCreateOutfits column to characters table', {
            context: 'migration.add-character-wardrobe-flags',
          });
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('Character wardrobe flags migration completed', {
        context: 'migration.add-character-wardrobe-flags',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-character-wardrobe-flags-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} column(s) to characters table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add character wardrobe flags', {
        context: 'migration.add-character-wardrobe-flags',
        error: errorMessage,
      });

      return {
        id: 'add-character-wardrobe-flags-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add character wardrobe flags',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
