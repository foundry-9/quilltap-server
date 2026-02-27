/**
 * Migration: Add File Status Field
 *
 * Adds a fileStatus field to the files table to track whether a file
 * is in good standing ('ok') or was discovered on disk without a
 * corresponding DB record ('orphaned').
 *
 * Migration ID: add-file-status-field-v1
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
 * Add File Status Field Migration
 */
export const addFileStatusFieldMigration: Migration = {
  id: 'add-file-status-field-v1',
  description: 'Add fileStatus field to files table for filesystem sync tracking',
  introducedInVersion: '3.2.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('files')) {
      return false;
    }

    const columns = getSQLiteTableColumns('files');
    const columnNames = columns.map((col) => col.name);

    return !columnNames.includes('fileStatus');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      if (sqliteTableExists('files')) {
        const columns = getSQLiteTableColumns('files');
        const columnNames = columns.map((col) => col.name);

        if (!columnNames.includes('fileStatus')) {
          db.exec(`ALTER TABLE "files" ADD COLUMN "fileStatus" TEXT DEFAULT 'ok'`);
          columnsAdded++;
          logger.info('Added fileStatus column to files table', {
            context: 'migration.add-file-status-field',
          });
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('File status field migration completed', {
        context: 'migration.add-file-status-field',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-file-status-field-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} column(s) to files table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add file status field', {
        context: 'migration.add-file-status-field',
        error: errorMessage,
      });

      return {
        id: 'add-file-status-field-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add file status field',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
