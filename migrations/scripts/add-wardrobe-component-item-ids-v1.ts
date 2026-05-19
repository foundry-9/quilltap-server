/**
 * Migration: Add Wardrobe componentItemIds Field
 *
 * Adds a componentItemIds TEXT column to wardrobe_items so a wardrobe item
 * can reference other wardrobe items as its components. This enables
 * composite items (e.g. a "rain outfit" that bundles a coat, boots, and a
 * hat) and replaces the soon-to-be-removed outfit_presets table.
 *
 * Migration ID: add-wardrobe-component-item-ids-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addWardrobeComponentItemIdsMigration: Migration = {
  id: 'add-wardrobe-component-item-ids-v1',
  description: 'Add componentItemIds column to wardrobe_items for composite items',
  introducedInVersion: '4.5.0',
  dependsOn: ['create-wardrobe-items-table-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('wardrobe_items')) {
      return false;
    }

    const columns = getSQLiteTableColumns('wardrobe_items');
    const columnNames = columns.map((col) => col.name);

    return !columnNames.includes('componentItemIds');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      logger.info('Starting componentItemIds column addition', {
        context: 'migration.add-wardrobe-component-item-ids',
      });

      if (sqliteTableExists('wardrobe_items')) {
        const columns = getSQLiteTableColumns('wardrobe_items');
        const columnNames = columns.map((col) => col.name);

        if (!columnNames.includes('componentItemIds')) {
          db.exec(
            `ALTER TABLE "wardrobe_items" ADD COLUMN "componentItemIds" TEXT DEFAULT NULL`
          );
          columnsAdded++;
          logger.info('Added componentItemIds column to wardrobe_items table', {
            context: 'migration.add-wardrobe-component-item-ids',
          });
        } else {
          logger.info('componentItemIds column already exists, skipping', {
            context: 'migration.add-wardrobe-component-item-ids',
          });
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('Wardrobe componentItemIds migration completed', {
        context: 'migration.add-wardrobe-component-item-ids',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-wardrobe-component-item-ids-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} column(s) to wardrobe_items table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add componentItemIds column to wardrobe_items', {
        context: 'migration.add-wardrobe-component-item-ids',
        error: errorMessage,
      });

      return {
        id: 'add-wardrobe-component-item-ids-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add componentItemIds column to wardrobe_items',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
