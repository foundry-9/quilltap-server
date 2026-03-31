/**
 * Migration: Add modelClass and maxContext Fields to Connection Profiles
 *
 * This migration adds:
 * - modelClass (TEXT): references a named model class (e.g., 'Compact', 'Standard',
 *   'Extended', 'Deep') that defines capability tiers for the profile.
 * - maxContext (INTEGER): optional override for the context window size in tokens.
 *
 * Both default to NULL (not set).
 *
 * Migration ID: add-connection-profile-model-class-field-v1
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
 * Add modelClass and maxContext Fields Migration
 */
export const addConnectionProfileModelClassFieldMigration: Migration = {
  id: 'add-connection-profile-model-class-field-v1',
  description: 'Add modelClass and maxContext fields to connection profiles',
  introducedInVersion: '3.0.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('connection_profiles')) {
      return false;
    }

    const columns = getSQLiteTableColumns('connection_profiles');
    const hasModelClass = columns.some((col) => col.name === 'modelClass');
    const hasMaxContext = columns.some((col) => col.name === 'maxContext');
    return !hasModelClass || !hasMaxContext;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();
      const columns = getSQLiteTableColumns('connection_profiles');
      const hasModelClass = columns.some((col) => col.name === 'modelClass');
      const hasMaxContext = columns.some((col) => col.name === 'maxContext');

      if (!hasModelClass) {
        db.exec('ALTER TABLE "connection_profiles" ADD COLUMN "modelClass" TEXT DEFAULT NULL');
      }
      if (!hasMaxContext) {
        db.exec('ALTER TABLE "connection_profiles" ADD COLUMN "maxContext" INTEGER DEFAULT NULL');
      }

      // Verify
      const updatedColumns = getSQLiteTableColumns('connection_profiles');
      const verifyModelClass = updatedColumns.some((col) => col.name === 'modelClass');
      const verifyMaxContext = updatedColumns.some((col) => col.name === 'maxContext');

      if (!verifyModelClass || !verifyMaxContext) {
        throw new Error('One or more columns were not added successfully');
      }

      logger.info('Added modelClass and maxContext columns to connection_profiles', {
        context: 'migration.add-connection-profile-model-class-field',
      });

      return {
        id: 'add-connection-profile-model-class-field-v1',
        success: true,
        itemsAffected: 2,
        message: 'Added modelClass and maxContext columns to connection_profiles table',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Failed to add modelClass/maxContext columns', {
        context: 'migration.add-connection-profile-model-class-field',
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        id: 'add-connection-profile-model-class-field-v1',
        success: false,
        itemsAffected: 0,
        message: `Failed to add columns: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
