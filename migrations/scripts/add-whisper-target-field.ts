/**
 * Migration: Add Whisper Target Field
 *
 * Adds the targetParticipantIds column to chat_messages table.
 * This column stores a JSON array of participant UUIDs for whisper messages.
 * NULL means the message is public (visible to all).
 *
 * Migration ID: add-whisper-target-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addWhisperTargetFieldMigration: Migration = {
  id: 'add-whisper-target-field-v1',
  description: 'Add targetParticipantIds column to chat_messages for whisper support',
  introducedInVersion: '2.15.0',
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

    return !columnNames.includes('targetParticipantIds');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      db.exec(`ALTER TABLE "chat_messages" ADD COLUMN "targetParticipantIds" TEXT DEFAULT NULL`);

      logger.info('Added targetParticipantIds column to chat_messages table', {
        context: 'migration.add-whisper-target-field',
      });

      const durationMs = Date.now() - startTime;

      return {
        id: 'add-whisper-target-field-v1',
        success: true,
        itemsAffected: 1,
        message: 'Added targetParticipantIds column to chat_messages',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add targetParticipantIds column', {
        context: 'migration.add-whisper-target-field',
        error: errorMessage,
      });

      return {
        id: 'add-whisper-target-field-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to add targetParticipantIds column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
