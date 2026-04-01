/**
 * Migration: Cleanup Orphan File Records
 *
 * This migration removes file records that don't have corresponding mount points.
 *
 * SQLite only - this is handled by the initial schema.
 * This migration is now a no-op for SQLite (MongoDB support removed).
 *
 * Migration ID: cleanup-orphan-file-records-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';

/**
 * Cleanup Orphan File Records Migration
 */
export const cleanupOrphanFileRecordsMigration: Migration = {
  id: 'cleanup-orphan-file-records-v1',
  description: 'Cleanup orphaned file records without mount points (SQLite only - no-op)',
  introducedInVersion: '2.7.0',
  dependsOn: [],

  async shouldRun(): Promise<boolean> {
    // No-op for SQLite
    return false;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    logger.info('Cleanup orphan file records migration skipped (SQLite only)', {
      context: 'migration.cleanup-orphan-file-records',
    });

    return {
      id: 'cleanup-orphan-file-records-v1',
      success: true,
      itemsAffected: 0,
      message: 'Skipped - SQLite handles orphaned records',
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  },
};
