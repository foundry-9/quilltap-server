/**
 * Migration: Drop API Key Encryption Columns
 *
 * Simplifies the api_keys table by removing the encryption columns
 * that are no longer needed after the single-user migration:
 * - RENAME COLUMN ciphertext → key_value
 * - DROP COLUMN iv
 * - DROP COLUMN authTag
 *
 * SQLite 3.35+ supports ALTER TABLE RENAME COLUMN and DROP COLUMN,
 * and better-sqlite3 bundles SQLite 3.45+, so this is safe.
 *
 * Migration ID: drop-api-key-encryption-columns-v1
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
 * Check if there is work to do
 */
function needsWork(): boolean {
  if (!isSQLiteBackend()) {
    return false;
  }

  if (!sqliteTableExists('api_keys')) {
    return false;
  }

  const columns = getSQLiteTableColumns('api_keys');

  // Need to run if ciphertext column still exists (needs rename)
  if (columns.some(c => c.name === 'ciphertext')) {
    return true;
  }

  // Need to run if iv or authTag columns still exist (need dropping)
  if (columns.some(c => c.name === 'iv' || c.name === 'authTag')) {
    return true;
  }

  return false;
}

/**
 * Run migration
 */
function runMigration(): MigrationResult {
  const startTime = Date.now();
  let itemsAffected = 0;

  try {
    const db = getSQLiteDatabase();
    const columns = getSQLiteTableColumns('api_keys');

    // Rename ciphertext → key_value
    if (columns.some(c => c.name === 'ciphertext')) {
      db.exec('ALTER TABLE api_keys RENAME COLUMN ciphertext TO key_value');
      itemsAffected++;
      logger.info('Renamed ciphertext to key_value in api_keys table', {
        context: 'migration.drop-api-key-encryption-columns',
      });
    }

    // Drop iv column
    if (columns.some(c => c.name === 'iv')) {
      db.exec('ALTER TABLE api_keys DROP COLUMN iv');
      itemsAffected++;
      logger.info('Dropped iv column from api_keys table', {
        context: 'migration.drop-api-key-encryption-columns',
      });
    }

    // Drop authTag column
    if (columns.some(c => c.name === 'authTag')) {
      db.exec('ALTER TABLE api_keys DROP COLUMN authTag');
      itemsAffected++;
      logger.info('Dropped authTag column from api_keys table', {
        context: 'migration.drop-api-key-encryption-columns',
      });
    }

    const durationMs = Date.now() - startTime;

    return {
      id: 'drop-api-key-encryption-columns-v1',
      success: true,
      itemsAffected,
      message: `Simplified api_keys table: ${itemsAffected} schema changes`,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Drop API key encryption columns migration failed', {
      context: 'migration.drop-api-key-encryption-columns',
      error: errorMessage,
    });

    return {
      id: 'drop-api-key-encryption-columns-v1',
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
 * Drop API Key Encryption Columns Migration
 */
export const dropApiKeyEncryptionColumnsMigration: Migration = {
  id: 'drop-api-key-encryption-columns-v1',
  description: 'Rename ciphertext to key_value and drop iv/authTag columns from api_keys',
  introducedInVersion: '3.2.0',
  dependsOn: ['reencrypt-api-keys-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }
    return needsWork();
  },

  async run(): Promise<MigrationResult> {
    logger.info('Starting drop API key encryption columns migration', {
      context: 'migration.drop-api-key-encryption-columns',
    });
    return runMigration();
  },
};
