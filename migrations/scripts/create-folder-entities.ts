/**
 * Migration: Create Folder Entities
 *
 * This migration creates the folder_entities table with appropriate indexes
 * for folder management functionality.
 *
 * SQLite only - this table is created as part of the schema.
 * This migration is now a no-op for SQLite (MongoDB support removed).
 *
 * Migration ID: create-folder-entities-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';

/**
 * Create Folder Entities Migration
 */
export const createFolderEntitiesMigration: Migration = {
  id: 'create-folder-entities-v1',
  description: 'Create folder_entities table for folder management (SQLite only - no-op)',
  introducedInVersion: '2.8.0',
  dependsOn: [],

  async shouldRun(): Promise<boolean> {
    // No-op for SQLite
    return false;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    logger.info('Create folder entities migration skipped (SQLite only)', {
      context: 'migration.create-folder-entities',
    });

    return {
      id: 'create-folder-entities-v1',
      success: true,
      itemsAffected: 0,
      message: 'Skipped - SQLite schema includes folder_entities table',
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  },
};
