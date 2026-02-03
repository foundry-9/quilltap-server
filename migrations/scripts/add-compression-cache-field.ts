/**
 * Migration: Add Compression Cache Field to Chats
 *
 * This migration adds a compressionCache TEXT field to the chats table.
 * The compressionCache stores pre-computed context compression results to
 * avoid re-compressing on every message, surviving server restarts.
 *
 * Migration ID: add-compression-cache-field-v1
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
 * Add Compression Cache Field Migration
 */
export const addCompressionCacheFieldMigration: Migration = {
  id: 'add-compression-cache-field-v1',
  description: 'Add compressionCache field to chats table for persistent compression results',
  introducedInVersion: '2.9.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    // Only run for SQLite backend
    if (!isSQLiteBackend()) {
      return false;
    }

    // Check if chats table exists
    if (!sqliteTableExists('chats')) {
      return false;
    }

    // Check if compressionCache column already exists
    const columns = getSQLiteTableColumns('chats');
    const columnNames = columns.map((col) => col.name);

    if (columnNames.includes('compressionCache')) {
      return false;
    }

    return true;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      // Add compressionCache column to chats
      // Default to NULL (no cached compression)
      db.exec(`ALTER TABLE "chats" ADD COLUMN "compressionCache" TEXT DEFAULT NULL`);

      const durationMs = Date.now() - startTime;

      logger.info('Added compressionCache column to chats table', {
        context: 'migration.add-compression-cache-field',
        durationMs,
      });

      return {
        id: 'add-compression-cache-field-v1',
        success: true,
        itemsAffected: 1,
        message: 'Added compressionCache column to chats table',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add compressionCache column', {
        context: 'migration.add-compression-cache-field',
        error: errorMessage,
      });

      return {
        id: 'add-compression-cache-field-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to add compressionCache column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
