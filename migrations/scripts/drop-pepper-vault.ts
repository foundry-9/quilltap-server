/**
 * Migration: Drop Pepper Vault
 *
 * Removes the pepper_vault table which is no longer needed
 * after the encryption simplification.
 *
 * Migration ID: drop-pepper-vault-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';

/**
 * Check if there is work to do
 */
function needsWork(): boolean {
  if (!isSQLiteBackend()) {
    return false;
  }

  return sqliteTableExists('pepper_vault');
}

/**
 * Run migration
 */
function runMigration(): MigrationResult {
  const startTime = Date.now();
  let itemsAffected = 0;

  try {
    const db = getSQLiteDatabase();

    if (sqliteTableExists('pepper_vault')) {
      db.exec('DROP TABLE IF EXISTS pepper_vault');
      itemsAffected++;
      logger.info('Dropped pepper_vault table', {
        context: 'migration.drop-pepper-vault',
      });
    }

    const durationMs = Date.now() - startTime;

    return {
      id: 'drop-pepper-vault-v1',
      success: true,
      itemsAffected,
      message: `Removed pepper_vault table: ${itemsAffected} schema changes`,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Drop pepper vault migration failed', {
      context: 'migration.drop-pepper-vault',
      error: errorMessage,
    });

    return {
      id: 'drop-pepper-vault-v1',
      success: false,
      itemsAffected,
      message: `Migration failed: ${errorMessage}`,
      error: errorMessage,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Drop Pepper Vault Migration
 */
export const dropPepperVaultMigration: Migration = {
  id: 'drop-pepper-vault-v1',
  description: 'Drop the pepper_vault table (encryption simplified)',
  introducedInVersion: '3.2.0',
  dependsOn: ['drop-api-key-encryption-columns-v1', 'decrypt-api-key-values-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }
    return needsWork();
  },

  async run(): Promise<MigrationResult> {
    logger.info('Starting drop pepper vault migration', {
      context: 'migration.drop-pepper-vault',
    });
    return runMigration();
  },
};
