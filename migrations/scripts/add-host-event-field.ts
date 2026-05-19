/**
 * Migration: Add Host Event Field
 *
 * Adds the hostEvent column to chat_messages. Stores a JSON object describing
 * the participant whose status changed and the new status, for Host
 * announcements (`systemSender = 'host'`) of type add / remove / status-change.
 * Other Host announcements (scenario, roster, timestamp, silent-mode, join
 * scenario) leave it NULL. Used by the per-character Librarian summary
 * pipeline to compute presence windows.
 *
 * Shape: { participantId: string, toStatus: 'active' | 'silent' | 'absent' | 'removed' }
 *
 * Migration ID: add-host-event-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addHostEventFieldMigration: Migration = {
  id: 'add-host-event-field-v1',
  description: 'Add hostEvent column to chat_messages for per-character Librarian summaries',
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

    return !columnNames.includes('hostEvent');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      db.exec(`ALTER TABLE "chat_messages" ADD COLUMN "hostEvent" TEXT DEFAULT NULL`);

      logger.info('Added hostEvent column to chat_messages table', {
        context: 'migration.add-host-event-field',
      });

      const durationMs = Date.now() - startTime;

      return {
        id: 'add-host-event-field-v1',
        success: true,
        itemsAffected: 1,
        message: 'Added hostEvent column to chat_messages',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add hostEvent column', {
        context: 'migration.add-host-event-field',
        error: errorMessage,
      });

      return {
        id: 'add-host-event-field-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to add hostEvent column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
