/**
 * Migration: Convert Character Scenario to Scenarios Array
 *
 * Adds a scenarios field (JSON array) to the characters table and migrates
 * existing single-string scenario data into the new array format.
 * Each existing scenario becomes { id, title: "Default", content, createdAt, updatedAt }.
 * The old scenario column is left in place but no longer used by the application.
 *
 * Migration ID: convert-scenario-to-scenarios-v1
 */

import { randomUUID } from 'crypto';
import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

/**
 * Convert Character Scenario to Scenarios Array Migration
 */
export const convertScenarioToScenariosMigration: Migration = {
  id: 'convert-scenario-to-scenarios-v1',
  description: 'Convert character scenario string to scenarios JSON array',
  introducedInVersion: '2.13.0',
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

    return !columnNames.includes('scenarios');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;
    let rowsMigrated = 0;

    try {
      const db = getSQLiteDatabase();

      if (sqliteTableExists('characters')) {
        const columns = getSQLiteTableColumns('characters');
        const columnNames = columns.map((col) => col.name);

        if (!columnNames.includes('scenarios')) {
          // Add the new scenarios column
          db.exec(`ALTER TABLE "characters" ADD COLUMN "scenarios" TEXT DEFAULT '[]'`);
          columnsAdded++;
          logger.info('Added scenarios column to characters table', {
            context: 'migration.convert-scenario-to-scenarios',
          });

          // Migrate existing scenario data if the old column exists
          if (columnNames.includes('scenario')) {
            const rows = db
              .prepare(`SELECT id, scenario, updatedAt FROM characters WHERE scenario IS NOT NULL AND scenario != ''`)
              .all() as Array<{ id: string; scenario: string; updatedAt: string }>;

            if (rows.length > 0) {
              const updateStmt = db.prepare(`UPDATE characters SET scenarios = ? WHERE id = ?`);

              const migrateAll = db.transaction(() => {
                for (const row of rows) {
                  const now = row.updatedAt || new Date().toISOString();
                  const scenarios = JSON.stringify([
                    {
                      id: randomUUID(),
                      title: 'Default',
                      content: row.scenario,
                      createdAt: now,
                      updatedAt: now,
                    },
                  ]);
                  updateStmt.run(scenarios, row.id);
                  rowsMigrated++;
                }
              });

              migrateAll();

              logger.info('Migrated existing scenario data to scenarios array', {
                context: 'migration.convert-scenario-to-scenarios',
                rowsMigrated,
              });
            }
          }
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('Character scenarios migration completed', {
        context: 'migration.convert-scenario-to-scenarios',
        columnsAdded,
        rowsMigrated,
        durationMs,
      });

      return {
        id: 'convert-scenario-to-scenarios-v1',
        success: true,
        itemsAffected: columnsAdded + rowsMigrated,
        message: `Added ${columnsAdded} column(s), migrated ${rowsMigrated} character(s)`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to convert scenario to scenarios array', {
        context: 'migration.convert-scenario-to-scenarios',
        error: errorMessage,
      });

      return {
        id: 'convert-scenario-to-scenarios-v1',
        success: false,
        itemsAffected: columnsAdded + rowsMigrated,
        message: 'Failed to convert scenario to scenarios array',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
