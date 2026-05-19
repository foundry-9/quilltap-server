/**
 * Migration: Add Custom Announcer Field
 *
 * Adds the customAnnouncer column to chat_messages. Stores a JSON object
 * describing an ad-hoc announcer (off-scene character or arbitrary custom
 * sender) for messages posted via the Insert Announcement composer button.
 * Mutually exclusive with `systemSender`: when set, the bubble renders with
 * the named character or custom display name instead of a Staff member.
 *
 * Shape:
 *   { kind: 'character', characterId: string }
 *   | { kind: 'custom', displayName: string }
 *
 * NULL on every other message.
 *
 * Migration ID: add-custom-announcer-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addCustomAnnouncerFieldMigration: Migration = {
  id: 'add-custom-announcer-field-v1',
  description: 'Add customAnnouncer column to chat_messages for ad-hoc announcement bubbles',
  introducedInVersion: '4.5.0',
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

    return !columnNames.includes('customAnnouncer');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      db.exec(`ALTER TABLE "chat_messages" ADD COLUMN "customAnnouncer" TEXT DEFAULT NULL`);

      logger.info('Added customAnnouncer column to chat_messages table', {
        context: 'migration.add-custom-announcer-field',
      });

      const durationMs = Date.now() - startTime;

      return {
        id: 'add-custom-announcer-field-v1',
        success: true,
        itemsAffected: 1,
        message: 'Added customAnnouncer column to chat_messages',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add customAnnouncer column', {
        context: 'migration.add-custom-announcer-field',
        error: errorMessage,
      });

      return {
        id: 'add-custom-announcer-field-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to add customAnnouncer column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
