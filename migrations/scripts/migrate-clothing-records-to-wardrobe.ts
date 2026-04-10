/**
 * Migration: Migrate Clothing Records to Wardrobe Items
 *
 * Converts existing clothingRecords JSON data on the characters table
 * into rows in the new wardrobe_items table.
 *
 * Migration ID: migrate-clothing-records-to-wardrobe-v1
 */

import crypto from 'node:crypto';
import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

/**
 * Migrate Clothing Records to Wardrobe Items Migration
 */
export const migrateClothingRecordsToWardrobeMigration: Migration = {
  id: 'migrate-clothing-records-to-wardrobe-v1',
  description: 'Migrate existing clothing records to wardrobe_items table',
  introducedInVersion: '4.3.0',
  dependsOn: ['create-wardrobe-items-table-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('wardrobe_items')) {
      return false;
    }

    if (!sqliteTableExists('characters')) {
      return false;
    }

    const columns = getSQLiteTableColumns('characters');
    const columnNames = columns.map((col) => col.name);

    if (!columnNames.includes('clothingRecords')) {
      return false;
    }

    const db = getSQLiteDatabase();

    // Check if there are characters with non-empty clothingRecords
    const hasRecords = db
      .prepare(
        `SELECT COUNT(*) as count FROM characters WHERE clothingRecords IS NOT NULL AND clothingRecords != '[]'`
      )
      .get() as { count: number };

    if (hasRecords.count === 0) {
      return false;
    }

    // Check if we've already migrated (wardrobe_items has rows with migratedFromClothingRecordId)
    const alreadyMigrated = db
      .prepare(
        `SELECT COUNT(*) as count FROM wardrobe_items WHERE migratedFromClothingRecordId IS NOT NULL`
      )
      .get() as { count: number };

    return alreadyMigrated.count === 0;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let itemsMigrated = 0;

    try {
      const db = getSQLiteDatabase();

      const characters = db
        .prepare(
          `SELECT id, clothingRecords FROM characters WHERE clothingRecords IS NOT NULL AND clothingRecords != '[]'`
        )
        .all() as Array<{ id: string; clothingRecords: string }>;

      const insertStmt = db.prepare(`
        INSERT INTO wardrobe_items (
          id, characterId, title, description, types, appropriateness,
          isDefault, migratedFromClothingRecordId, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const now = new Date().toISOString();

      const insertAll = db.transaction(() => {
        for (const character of characters) {
          let records: Array<{
            id: string;
            name: string;
            description?: string | null;
            usageContext?: string | null;
            createdAt?: string;
          }>;

          try {
            records = JSON.parse(character.clothingRecords);
          } catch {
            logger.warn('Failed to parse clothingRecords JSON for character', {
              context: 'migration.migrate-clothing-records-to-wardrobe',
              characterId: character.id,
            });
            continue;
          }

          if (!Array.isArray(records) || records.length === 0) {
            continue;
          }

          for (let i = 0; i < records.length; i++) {
            const record = records[i];
            const newId = crypto.randomUUID();
            const isDefault = i === 0 ? 1 : 0;
            const types = '["top","bottom","footwear","accessories"]';

            insertStmt.run(
              newId,
              character.id,
              record.name,
              record.description ?? null,
              types,
              record.usageContext ?? null,
              isDefault,
              record.id,
              record.createdAt ?? now,
              now
            );

            itemsMigrated++;
          }
        }
      });

      insertAll();

      const durationMs = Date.now() - startTime;

      logger.info('Clothing records to wardrobe migration completed', {
        context: 'migration.migrate-clothing-records-to-wardrobe',
        itemsMigrated,
        charactersProcessed: characters.length,
        durationMs,
      });

      return {
        id: 'migrate-clothing-records-to-wardrobe-v1',
        success: true,
        itemsAffected: itemsMigrated,
        message: `Migrated ${itemsMigrated} clothing record(s) to wardrobe_items table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to migrate clothing records to wardrobe', {
        context: 'migration.migrate-clothing-records-to-wardrobe',
        error: errorMessage,
      });

      return {
        id: 'migrate-clothing-records-to-wardrobe-v1',
        success: false,
        itemsAffected: itemsMigrated,
        message: 'Failed to migrate clothing records to wardrobe',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
