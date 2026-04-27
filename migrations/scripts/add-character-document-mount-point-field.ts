/**
 * Migration: Add Character Document Mount Point Field
 *
 * Adds a characterDocumentMountPointId field to the characters table
 * so each character can be linked to a single character-classified document
 * store (mountType='database', storeType='character'). Nullable (null = not
 * linked). This is a soft FK — no referential constraints are added since the
 * mount point lives in a separate database (quilltap-mount-index.db).
 *
 * Migration ID: add-character-document-mount-point-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addCharacterDocumentMountPointFieldMigration: Migration = {
  id: 'add-character-document-mount-point-field-v1',
  description: 'Add characterDocumentMountPointId field to characters table',
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

    return !columnNames.includes('characterDocumentMountPointId');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      if (sqliteTableExists('characters')) {
        const columns = getSQLiteTableColumns('characters');
        const columnNames = columns.map((col) => col.name);

        if (!columnNames.includes('characterDocumentMountPointId')) {
          db.exec(`ALTER TABLE "characters" ADD COLUMN "characterDocumentMountPointId" TEXT DEFAULT NULL`);
          columnsAdded++;
          logger.info('Added characterDocumentMountPointId column to characters table', {
            context: 'migration.add-character-document-mount-point-field',
          });
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('Character document mount point field migration completed', {
        context: 'migration.add-character-document-mount-point-field',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-character-document-mount-point-field-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} column(s) to characters table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add character document mount point field', {
        context: 'migration.add-character-document-mount-point-field',
        error: errorMessage,
      });

      return {
        id: 'add-character-document-mount-point-field-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add character document mount point field',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
