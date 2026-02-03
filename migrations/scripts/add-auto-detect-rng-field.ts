/**
 * Migration: Add autoDetectRng Field to Chat Settings
 *
 * This migration adds an autoDetectRng INTEGER field to the chat_settings table.
 * When enabled (default), the system automatically detects and executes RNG patterns
 * like dice rolls and coin flips in user messages.
 *
 * Migration ID: add-auto-detect-rng-field-v1
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
 * Add autoDetectRng Field Migration
 */
export const addAutoDetectRngFieldMigration: Migration = {
  id: 'add-auto-detect-rng-field-v1',
  description: 'Add autoDetectRng field to chat_settings table for automatic RNG pattern detection',
  introducedInVersion: '2.8.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    // Only run for SQLite backend
    if (!isSQLiteBackend()) {
      return false;
    }

    // Check if chat_settings table exists
    if (!sqliteTableExists('chat_settings')) {
      return false;
    }

    // Check if autoDetectRng column already exists
    const columns = getSQLiteTableColumns('chat_settings');
    const columnNames = columns.map((col) => col.name);

    if (!columnNames.includes('autoDetectRng')) {
      return true;
    }

    return false;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      // Check and add autoDetectRng column
      const columns = getSQLiteTableColumns('chat_settings');
      const columnNames = columns.map((col) => col.name);

      if (!columnNames.includes('autoDetectRng')) {
        // SQLite uses INTEGER for boolean, 1 = true (default enabled)
        db.exec(`ALTER TABLE "chat_settings" ADD COLUMN "autoDetectRng" INTEGER DEFAULT 1`);
        columnsAdded++;
        logger.info('Added autoDetectRng column to chat_settings table', {
          context: 'migration.add-auto-detect-rng-field',
        });
      }

      const durationMs = Date.now() - startTime;

      logger.info('Added autoDetectRng column to chat_settings table', {
        context: 'migration.add-auto-detect-rng-field',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-auto-detect-rng-field-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added autoDetectRng column to chat_settings table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add autoDetectRng column', {
        context: 'migration.add-auto-detect-rng-field',
        error: errorMessage,
      });

      return {
        id: 'add-auto-detect-rng-field-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add autoDetectRng column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
