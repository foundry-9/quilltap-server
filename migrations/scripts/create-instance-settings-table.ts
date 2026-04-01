/**
 * Migration: Create Instance Settings Table
 *
 * Creates the instance_settings key-value table for instance-level configuration.
 * Used by the version guard to track the highest app version that has touched this database.
 *
 * Migration ID: create-instance-settings-table-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';

export const createInstanceSettingsTableMigration: Migration = {
  id: 'create-instance-settings-table-v1',
  description: 'Create instance_settings key-value table for instance-level configuration',
  introducedInVersion: '3.3.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    return !sqliteTableExists('instance_settings');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      db.exec(`CREATE TABLE IF NOT EXISTS "instance_settings" (
        "key" TEXT PRIMARY KEY,
        "value" TEXT NOT NULL
      )`);

      const durationMs = Date.now() - startTime;

      logger.info('Instance settings table created', {
        context: 'migrations.create-instance-settings-table.run',
        durationMs,
      });

      return {
        id: 'create-instance-settings-table-v1',
        success: true,
        itemsAffected: 1,
        message: 'Created instance_settings table',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to create instance_settings table', {
        context: 'migrations.create-instance-settings-table.run',
        error: errorMessage,
      });

      return {
        id: 'create-instance-settings-table-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to create instance_settings table',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
