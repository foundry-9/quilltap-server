/**
 * Migration: Per-Project Mount Points
 *
 * This migration updates the schema to support per-project mount points:
 * - Removes the isProjectDefault field from all mount points (no longer used)
 * - Adds an index on projects.mountPointId for efficient lookups
 *
 * SQLite only - this is handled by the schema.
 * This migration is now a no-op for SQLite (MongoDB support removed).
 *
 * Migration ID: per-project-mount-points-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';

/**
 * Per-Project Mount Points Migration
 */
export const perProjectMountPointsMigration: Migration = {
  id: 'per-project-mount-points-v1',
  description: 'Update schema for per-project mount points (SQLite only - no-op)',
  introducedInVersion: '2.8.0',
  dependsOn: [],

  async shouldRun(): Promise<boolean> {
    // No-op for SQLite
    return false;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    logger.info('Per-project mount points migration skipped (SQLite only)', {
      context: 'migration.per-project-mount-points',
    });

    return {
      id: 'per-project-mount-points-v1',
      success: true,
      itemsAffected: 0,
      message: 'Skipped - SQLite schema includes per-project mount points',
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  },
};
