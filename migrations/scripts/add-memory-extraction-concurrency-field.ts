/**
 * Migration: Add Memory Extraction Concurrency Field
 *
 * Adds the memoryExtractionConcurrency column to the chat_settings table.
 * Controls how many MEMORY_EXTRACTION background jobs run in parallel.
 * Default of 1 preserves the historical sequential behaviour; the cap at 32
 * matches the upper bound of the `memory-diff` CLI's `--concurrency` flag.
 *
 * Migration ID: add-memory-extraction-concurrency-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addMemoryExtractionConcurrencyFieldMigration: Migration = {
  id: 'add-memory-extraction-concurrency-field-v1',
  description: 'Add memoryExtractionConcurrency column to chat_settings table',
  introducedInVersion: '4.4.0',
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

    return !columnNames.includes('memoryExtractionConcurrency');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      db.exec(
        `ALTER TABLE "chat_settings" ADD COLUMN "memoryExtractionConcurrency" INTEGER DEFAULT 1`
      );

      const durationMs = Date.now() - startTime;

      logger.info('Added memoryExtractionConcurrency column to chat_settings table', {
        context: 'migration.add-memory-extraction-concurrency-field',
        durationMs,
      });

      return {
        id: 'add-memory-extraction-concurrency-field-v1',
        success: true,
        itemsAffected: 1,
        message: 'Added memoryExtractionConcurrency column to chat_settings table',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add memoryExtractionConcurrency field', {
        context: 'migration.add-memory-extraction-concurrency-field',
        error: errorMessage,
      });

      return {
        id: 'add-memory-extraction-concurrency-field-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to add memoryExtractionConcurrency field',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
