/**
 * Migration: Create Outfit Presets and Archive
 *
 * Creates the outfit_presets table for saved outfit configurations and adds
 * an archivedAt column to wardrobe_items for soft-archiving items.
 *
 * Migration ID: create-outfit-presets-and-archive-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const createOutfitPresetsAndArchiveMigration: Migration = {
  id: 'create-outfit-presets-and-archive-v1',
  description: 'Create outfit_presets table and add archivedAt to wardrobe_items',
  introducedInVersion: '4.3.0',
  dependsOn: ['create-wardrobe-items-table-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    return !sqliteTableExists('outfit_presets');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let itemsAffected = 0;

    try {
      const db = getSQLiteDatabase();

      // Create outfit_presets table
      db.exec(`
        CREATE TABLE IF NOT EXISTS "outfit_presets" (
          "id" TEXT PRIMARY KEY,
          "characterId" TEXT,
          "name" TEXT NOT NULL,
          "description" TEXT,
          "slots" TEXT NOT NULL,
          "createdAt" TEXT NOT NULL,
          "updatedAt" TEXT NOT NULL,
          FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS "idx_outfit_presets_character" ON "outfit_presets"("characterId");
      `);
      itemsAffected++;
      logger.info('Created outfit_presets table', {
        context: 'migration.create-outfit-presets-and-archive',
      });

      // Add archivedAt column to wardrobe_items if it doesn't exist
      if (sqliteTableExists('wardrobe_items')) {
        const columns = getSQLiteTableColumns('wardrobe_items');
        const columnNames = columns.map((col) => col.name);

        if (!columnNames.includes('archivedAt')) {
          db.exec(`ALTER TABLE "wardrobe_items" ADD COLUMN "archivedAt" TEXT DEFAULT NULL`);
          itemsAffected++;
          logger.info('Added archivedAt column to wardrobe_items table', {
            context: 'migration.create-outfit-presets-and-archive',
          });
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('Outfit presets and archive migration completed', {
        context: 'migration.create-outfit-presets-and-archive',
        itemsAffected,
        durationMs,
      });

      return {
        id: 'create-outfit-presets-and-archive-v1',
        success: true,
        itemsAffected,
        message: `Created outfit_presets table and updated wardrobe_items (${itemsAffected} operation(s))`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to create outfit presets and archive', {
        context: 'migration.create-outfit-presets-and-archive',
        error: errorMessage,
      });

      return {
        id: 'create-outfit-presets-and-archive-v1',
        success: false,
        itemsAffected,
        message: 'Failed to create outfit presets and archive',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
