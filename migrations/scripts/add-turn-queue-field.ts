/**
 * Migration: Add Turn Queue Field
 *
 * Adds the turnQueue column to the chats table.
 * This column stores a JSON array of participant UUIDs for server-side
 * turn management, enabling chained responses in multi-character chats.
 *
 * Migration ID: add-turn-queue-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addTurnQueueFieldMigration: Migration = {
  id: 'add-turn-queue-field-v1',
  description: 'Add turnQueue column to chats for server-side turn management',
  introducedInVersion: '3.3.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chats')) {
      return false;
    }

    const columns = getSQLiteTableColumns('chats');
    const columnNames = columns.map((col) => col.name);

    return !columnNames.includes('turnQueue');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      db.exec(`ALTER TABLE "chats" ADD COLUMN "turnQueue" TEXT DEFAULT '[]'`);

      logger.info('Added turnQueue column to chats table', {
        context: 'migration.add-turn-queue-field',
      });

      const durationMs = Date.now() - startTime;

      return {
        id: 'add-turn-queue-field-v1',
        success: true,
        itemsAffected: 1,
        message: 'Added turnQueue column to chats',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add turnQueue column', {
        context: 'migration.add-turn-queue-field',
        error: errorMessage,
      });

      return {
        id: 'add-turn-queue-field-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to add turnQueue column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
