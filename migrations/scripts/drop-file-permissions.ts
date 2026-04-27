/**
 * Migration: Drop File Permissions
 *
 * Removes the file_permissions table. The LLM-facing file_management tool
 * and its approval flow have been retired — document writes go through the
 * Scriptorium doc_* tool family, which stores permissions on the document
 * store itself.
 *
 * Migration ID: drop-file-permissions-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';

function needsWork(): boolean {
  if (!isSQLiteBackend()) {
    return false;
  }
  return sqliteTableExists('file_permissions');
}

function runMigration(): MigrationResult {
  const startTime = Date.now();
  let itemsAffected = 0;

  try {
    const db = getSQLiteDatabase();

    if (sqliteTableExists('file_permissions')) {
      db.exec('DROP TABLE IF EXISTS file_permissions');
      itemsAffected++;
      logger.info('Dropped file_permissions table', {
        context: 'migration.drop-file-permissions',
      });
    }

    const durationMs = Date.now() - startTime;

    return {
      id: 'drop-file-permissions-v1',
      success: true,
      itemsAffected,
      message: `Removed file_permissions table: ${itemsAffected} schema changes`,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Drop file_permissions migration failed', {
      context: 'migration.drop-file-permissions',
      error: errorMessage,
    });

    return {
      id: 'drop-file-permissions-v1',
      success: false,
      itemsAffected,
      message: `Migration failed: ${errorMessage}`,
      error: errorMessage,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

export const dropFilePermissionsMigration: Migration = {
  id: 'drop-file-permissions-v1',
  description: 'Remove file_permissions table (LLM write permission approval flow retired)',
  introducedInVersion: '4.3.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }
    return needsWork();
  },

  async run(): Promise<MigrationResult> {
    logger.info('Starting drop file_permissions migration', {
      context: 'migration.drop-file-permissions',
    });
    return runMigration();
  },
};
