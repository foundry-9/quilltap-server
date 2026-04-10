/**
 * Migration: Add Equipped Outfit Field
 *
 * Adds an equippedOutfit field to the chats table for per-character outfit
 * tracking. Stored as TEXT, default NULL.
 *
 * Migration ID: add-equipped-outfit-field-v1
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
 * Add Equipped Outfit Field Migration
 */
export const addEquippedOutfitFieldMigration: Migration = {
  id: 'add-equipped-outfit-field-v1',
  description: 'Add equippedOutfit field to chats table for per-character outfit tracking',
  introducedInVersion: '4.3.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chats')) {
      return false;
    }

    const columns = getSQLiteTableColumns('chats');
    const columnNames = columns.map((col) => col.name);

    return !columnNames.includes('equippedOutfit');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      if (sqliteTableExists('chats')) {
        const columns = getSQLiteTableColumns('chats');
        const columnNames = columns.map((col) => col.name);

        if (!columnNames.includes('equippedOutfit')) {
          db.exec(`ALTER TABLE "chats" ADD COLUMN "equippedOutfit" TEXT DEFAULT NULL`);
          columnsAdded++;
          logger.info('Added equippedOutfit column to chats table', {
            context: 'migration.add-equipped-outfit-field',
          });
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('Equipped outfit field migration completed', {
        context: 'migration.add-equipped-outfit-field',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-equipped-outfit-field-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} column(s) to chats table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add equipped outfit field', {
        context: 'migration.add-equipped-outfit-field',
        error: errorMessage,
      });

      return {
        id: 'add-equipped-outfit-field-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add equipped outfit field',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
