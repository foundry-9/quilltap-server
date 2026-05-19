/**
 * Migration: Add Summary Anchor Field
 *
 * Adds the summaryAnchor column to chat_messages. Stores a JSON object tying
 * a Staff-authored whisper to the compaction generation under which it was
 * produced. Used by the per-character Librarian summary pipeline to
 * deterministically sweep stale whispers when `compactionGeneration` bumps,
 * replacing the prior content-prefix sweep heuristic.
 *
 * Shape: { compactionGeneration: number }
 *
 * Migration ID: add-summary-anchor-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addSummaryAnchorFieldMigration: Migration = {
  id: 'add-summary-anchor-field-v1',
  description: 'Add summaryAnchor column to chat_messages for generation-anchored whisper sweeps',
  introducedInVersion: '4.4.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chat_messages')) {
      return false;
    }

    const columns = getSQLiteTableColumns('chat_messages');
    const columnNames = columns.map((col) => col.name);

    return !columnNames.includes('summaryAnchor');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      db.exec(`ALTER TABLE "chat_messages" ADD COLUMN "summaryAnchor" TEXT DEFAULT NULL`);

      logger.info('Added summaryAnchor column to chat_messages table', {
        context: 'migration.add-summary-anchor-field',
      });

      const durationMs = Date.now() - startTime;

      return {
        id: 'add-summary-anchor-field-v1',
        success: true,
        itemsAffected: 1,
        message: 'Added summaryAnchor column to chat_messages',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add summaryAnchor column', {
        context: 'migration.add-summary-anchor-field',
        error: errorMessage,
      });

      return {
        id: 'add-summary-anchor-field-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to add summaryAnchor column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
