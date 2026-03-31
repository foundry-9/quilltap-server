/**
 * Migration: Add maxTokens Field to Connection Profiles
 *
 * This migration adds:
 * - maxTokens (INTEGER): optional override for the maximum tokens that can be sent
 *   in a single request to the connection's LLM provider.
 *
 * Defaults to NULL (not set).
 *
 * Migration ID: add-connection-profile-max-tokens-field-v1
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
 * Add maxTokens Field Migration
 */
export const addConnectionProfileMaxTokensFieldMigration: Migration = {
  id: 'add-connection-profile-max-tokens-field-v1',
  description: 'Add maxTokens field to connection profiles',
  introducedInVersion: '3.1.0',
  dependsOn: ['add-connection-profile-model-class-field-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('connection_profiles')) {
      return false;
    }

    const columns = getSQLiteTableColumns('connection_profiles');
    const hasMaxTokens = columns.some((col) => col.name === 'maxTokens');
    return !hasMaxTokens;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();
      const columns = getSQLiteTableColumns('connection_profiles');
      const hasMaxTokens = columns.some((col) => col.name === 'maxTokens');

      if (!hasMaxTokens) {
        db.exec('ALTER TABLE "connection_profiles" ADD COLUMN "maxTokens" INTEGER DEFAULT NULL');
      }

      // Verify
      const updatedColumns = getSQLiteTableColumns('connection_profiles');
      const verifyMaxTokens = updatedColumns.some((col) => col.name === 'maxTokens');

      if (!verifyMaxTokens) {
        throw new Error('maxTokens column was not added successfully');
      }

      logger.info('Added maxTokens column to connection_profiles', {
        context: 'migration.add-connection-profile-max-tokens-field',
      });

      return {
        id: 'add-connection-profile-max-tokens-field-v1',
        success: true,
        itemsAffected: 1,
        message: 'Added maxTokens column to connection_profiles table',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Failed to add maxTokens column', {
        context: 'migration.add-connection-profile-max-tokens-field',
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        id: 'add-connection-profile-max-tokens-field-v1',
        success: false,
        itemsAffected: 0,
        message: `Failed to add column: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
