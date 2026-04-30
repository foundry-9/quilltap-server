/**
 * Migration: Add Summary Anchor Message IDs Field
 *
 * Adds the summaryAnchorMessageIds column to chats. Stores a JSON array of
 * conversation message IDs (USER + ASSISTANT) that fed the current
 * `contextSummary`. The edit/delete invalidation hook checks whether a
 * changed message ID is in this set to decide whether to clear the summary
 * — typo fixes on a message that arrived after the last summary leave the
 * summary intact.
 *
 * Migration ID: add-summary-anchor-message-ids-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addSummaryAnchorMessageIdsFieldMigration: Migration = {
  id: 'add-summary-anchor-message-ids-field-v1',
  description: 'Add summaryAnchorMessageIds column to chats for edit-aware summary invalidation',
  introducedInVersion: '4.4.0',
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

    return !columnNames.includes('summaryAnchorMessageIds');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      db.exec(`ALTER TABLE "chats" ADD COLUMN "summaryAnchorMessageIds" TEXT DEFAULT '[]'`);

      logger.info('Added summaryAnchorMessageIds column to chats table', {
        context: 'migration.add-summary-anchor-message-ids-field',
      });

      const durationMs = Date.now() - startTime;

      return {
        id: 'add-summary-anchor-message-ids-field-v1',
        success: true,
        itemsAffected: 1,
        message: 'Added summaryAnchorMessageIds column to chats',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add summaryAnchorMessageIds column', {
        context: 'migration.add-summary-anchor-message-ids-field',
        error: errorMessage,
      });

      return {
        id: 'add-summary-anchor-message-ids-field-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to add summaryAnchorMessageIds column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
