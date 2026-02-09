/**
 * Migration: Add Memory Gate Fields
 *
 * This migration adds Memory Gate fields to the memories table:
 * - reinforcementCount: INTEGER DEFAULT 1 (how many times this memory has been observed)
 * - lastReinforcedAt: TEXT DEFAULT NULL (timestamp of last reinforcement)
 * - relatedMemoryIds: TEXT DEFAULT '[]' (JSON array of related memory IDs)
 * - reinforcedImportance: REAL DEFAULT 0.5 (importance boosted by reinforcement)
 *
 * After adding columns, syncs reinforcedImportance = importance for existing rows.
 *
 * Migration ID: add-memory-gate-fields-v1
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
 * Add Memory Gate Fields Migration
 */
export const addMemoryGateFieldsMigration: Migration = {
  id: 'add-memory-gate-fields-v1',
  description: 'Add memory gate fields (reinforcement tracking, related links) to memories table',
  introducedInVersion: '2.10.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    // Only run for SQLite backend
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('memories')) {
      return false;
    }

    const columns = getSQLiteTableColumns('memories');
    const columnNames = columns.map((col) => col.name);

    // Run if any of the new columns are missing
    const requiredColumns = [
      'reinforcementCount',
      'lastReinforcedAt',
      'relatedMemoryIds',
      'reinforcedImportance',
    ];

    return requiredColumns.some((col) => !columnNames.includes(col));
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;
    let rowsUpdated = 0;

    try {
      const db = getSQLiteDatabase();
      const columns = getSQLiteTableColumns('memories');
      const columnNames = columns.map((col) => col.name);

      // Add reinforcementCount column
      if (!columnNames.includes('reinforcementCount')) {
        db.exec(`ALTER TABLE "memories" ADD COLUMN "reinforcementCount" INTEGER DEFAULT 1`);
        columnsAdded++;
        logger.info('Added reinforcementCount column to memories table', {
          context: 'migration.add-memory-gate-fields',
        });
      }

      // Add lastReinforcedAt column
      if (!columnNames.includes('lastReinforcedAt')) {
        db.exec(`ALTER TABLE "memories" ADD COLUMN "lastReinforcedAt" TEXT DEFAULT NULL`);
        columnsAdded++;
        logger.info('Added lastReinforcedAt column to memories table', {
          context: 'migration.add-memory-gate-fields',
        });
      }

      // Add relatedMemoryIds column (JSON array, stored as TEXT)
      if (!columnNames.includes('relatedMemoryIds')) {
        db.exec(`ALTER TABLE "memories" ADD COLUMN "relatedMemoryIds" TEXT DEFAULT '[]'`);
        columnsAdded++;
        logger.info('Added relatedMemoryIds column to memories table', {
          context: 'migration.add-memory-gate-fields',
        });
      }

      // Add reinforcedImportance column
      if (!columnNames.includes('reinforcedImportance')) {
        db.exec(`ALTER TABLE "memories" ADD COLUMN "reinforcedImportance" REAL DEFAULT 0.5`);
        columnsAdded++;
        logger.info('Added reinforcedImportance column to memories table', {
          context: 'migration.add-memory-gate-fields',
        });

        // Sync existing rows: set reinforcedImportance = importance
        const result = db.prepare(
          `UPDATE "memories" SET "reinforcedImportance" = "importance" WHERE "reinforcedImportance" != "importance"`
        ).run();
        rowsUpdated = result.changes;

        logger.info('Synced reinforcedImportance with importance for existing memories', {
          context: 'migration.add-memory-gate-fields',
          rowsUpdated,
        });
      }

      const durationMs = Date.now() - startTime;

      logger.info('Added memory gate fields to memories table', {
        context: 'migration.add-memory-gate-fields',
        columnsAdded,
        rowsUpdated,
        durationMs,
      });

      return {
        id: 'add-memory-gate-fields-v1',
        success: true,
        itemsAffected: columnsAdded + rowsUpdated,
        message: `Added ${columnsAdded} memory gate column(s), synced ${rowsUpdated} existing row(s)`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add memory gate fields', {
        context: 'migration.add-memory-gate-fields',
        error: errorMessage,
      });

      return {
        id: 'add-memory-gate-fields-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add memory gate fields',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
