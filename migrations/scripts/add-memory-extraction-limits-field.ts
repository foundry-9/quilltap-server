/**
 * Migration: Add Memory Extraction Limits Field
 *
 * Adds the memoryExtractionLimits column to the chat_settings table. The
 * rate limiter gates automatic memory extraction when a character has
 * produced more than `maxPerHour` memories in the trailing 60 minutes,
 * applying a graduated importance floor rather than a hard skip.
 *
 * Migration ID: add-memory-extraction-limits-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addMemoryExtractionLimitsFieldMigration: Migration = {
  id: 'add-memory-extraction-limits-field-v1',
  description: 'Add memoryExtractionLimits column to chat_settings table',
  introducedInVersion: '4.3.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chat_settings')) {
      return false;
    }

    const columns = getSQLiteTableColumns('chat_settings');
    const columnNames = columns.map((col) => col.name);

    return !columnNames.includes('memoryExtractionLimits');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      const defaultMemoryExtractionLimits = JSON.stringify({
        enabled: false,
        maxPerHour: 20,
        softStartFraction: 0.7,
        softFloor: 0.7,
      });

      db.exec(
        `ALTER TABLE "chat_settings" ADD COLUMN "memoryExtractionLimits" TEXT DEFAULT '${defaultMemoryExtractionLimits}'`
      );

      const durationMs = Date.now() - startTime;

      logger.info('Added memoryExtractionLimits column to chat_settings table', {
        context: 'migration.add-memory-extraction-limits-field',
        durationMs,
      });

      return {
        id: 'add-memory-extraction-limits-field-v1',
        success: true,
        itemsAffected: 1,
        message: 'Added memoryExtractionLimits column to chat_settings table',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add memoryExtractionLimits field', {
        context: 'migration.add-memory-extraction-limits-field',
        error: errorMessage,
      });

      return {
        id: 'add-memory-extraction-limits-field-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to add memoryExtractionLimits field',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
