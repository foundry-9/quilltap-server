/**
 * Migration: Fix Missing Storage Keys
 *
 * This migration ensures all file records have proper storage keys.
 *
 * SQLite only - this is handled by the schema.
 * This migration is now a no-op for SQLite (MongoDB support removed).
 *
 * Migration ID: fix-missing-storage-keys-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';

/**
 * Fix Missing Storage Keys Migration
 */
export const fixMissingStorageKeysMigration: Migration = {
  id: 'fix-missing-storage-keys-v1',
  description: 'Fix missing storage keys in file records (SQLite only - no-op)',
  introducedInVersion: '2.7.0',
  dependsOn: [],

  async shouldRun(): Promise<boolean> {
    // No-op for SQLite
    return false;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    logger.info('Fix missing storage keys migration skipped (SQLite only)', {
      context: 'migration.fix-missing-storage-keys',
    });

    return {
      id: 'fix-missing-storage-keys-v1',
      success: true,
      itemsAffected: 0,
      message: 'Skipped - SQLite schema ensures storage keys',
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  },
};
