/**
 * Migration: Create Wardrobe Items Table
 *
 * Creates the wardrobe_items table for the modular wardrobe system,
 * allowing characters to have individual wardrobe item records with
 * types, appropriateness, and default flags.
 *
 * Migration ID: create-wardrobe-items-table-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';

/**
 * Create Wardrobe Items Table Migration
 */
export const createWardrobeItemsTableMigration: Migration = {
  id: 'create-wardrobe-items-table-v1',
  description: 'Create wardrobe_items table for modular wardrobe system',
  introducedInVersion: '4.3.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    return !sqliteTableExists('wardrobe_items');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let itemsAffected = 0;

    try {
      const db = getSQLiteDatabase();

      if (!sqliteTableExists('wardrobe_items')) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS "wardrobe_items" (
            "id" TEXT PRIMARY KEY,
            "characterId" TEXT,
            "title" TEXT NOT NULL,
            "description" TEXT,
            "types" TEXT NOT NULL DEFAULT '[]',
            "appropriateness" TEXT,
            "isDefault" INTEGER DEFAULT 0,
            "migratedFromClothingRecordId" TEXT,
            "createdAt" TEXT NOT NULL,
            "updatedAt" TEXT NOT NULL,
            FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE CASCADE
          );
        `);
        itemsAffected++;
        logger.info('Created wardrobe_items table', {
          context: 'migration.create-wardrobe-items-table',
        });

        db.exec(`
          CREATE INDEX IF NOT EXISTS "idx_wardrobe_items_character" ON "wardrobe_items"("characterId");
        `);
        logger.info('Created index idx_wardrobe_items_character', {
          context: 'migration.create-wardrobe-items-table',
        });
      }

      const durationMs = Date.now() - startTime;

      logger.info('Wardrobe items table migration completed', {
        context: 'migration.create-wardrobe-items-table',
        itemsAffected,
        durationMs,
      });

      return {
        id: 'create-wardrobe-items-table-v1',
        success: true,
        itemsAffected,
        message: `Created wardrobe_items table and ${itemsAffected} index(es)`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to create wardrobe_items table', {
        context: 'migration.create-wardrobe-items-table',
        error: errorMessage,
      });

      return {
        id: 'create-wardrobe-items-table-v1',
        success: false,
        itemsAffected,
        message: 'Failed to create wardrobe_items table',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
