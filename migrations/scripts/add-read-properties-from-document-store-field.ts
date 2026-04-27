/**
 * Migration: Add readPropertiesFromDocumentStore Field
 *
 * Adds a readPropertiesFromDocumentStore boolean column to the characters table.
 * When true (and the character has a linked document-store vault), reads of
 * pronouns, aliases, title, firstMessage, and talkativeness return the vault's
 * properties.json values instead of the DB row. Writes still target the DB.
 *
 * Migration ID: add-read-properties-from-document-store-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addReadPropertiesFromDocumentStoreFieldMigration: Migration = {
  id: 'add-read-properties-from-document-store-field-v1',
  description: 'Add readPropertiesFromDocumentStore column to characters table',
  introducedInVersion: '4.4.0',
  dependsOn: ['sqlite-initial-schema-v1', 'add-character-document-mount-point-field-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('characters')) {
      return false;
    }

    const columns = getSQLiteTableColumns('characters');
    const columnNames = columns.map((col) => col.name);

    return !columnNames.includes('readPropertiesFromDocumentStore');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      if (sqliteTableExists('characters')) {
        const columns = getSQLiteTableColumns('characters');
        const columnNames = columns.map((col) => col.name);

        if (!columnNames.includes('readPropertiesFromDocumentStore')) {
          db.exec(
            `ALTER TABLE "characters" ADD COLUMN "readPropertiesFromDocumentStore" INTEGER DEFAULT NULL`
          );
          columnsAdded++;
          logger.info('Added readPropertiesFromDocumentStore column to characters table', {
            context: 'migration.add-read-properties-from-document-store-field',
          });
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('readPropertiesFromDocumentStore field migration completed', {
        context: 'migration.add-read-properties-from-document-store-field',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-read-properties-from-document-store-field-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} column(s) to characters table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add readPropertiesFromDocumentStore field', {
        context: 'migration.add-read-properties-from-document-store-field',
        error: errorMessage,
      });

      return {
        id: 'add-read-properties-from-document-store-field-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add readPropertiesFromDocumentStore field',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
