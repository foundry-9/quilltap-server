/**
 * Migration: Add Chat Informs Table
 *
 * Creates the chat_informs table backing the Salon's **Inform** action — an
 * out-of-character passage the operator hands to one or more LLM-controlled
 * seats, delivered verbatim as its own system block on each target's next
 * generation and consumed once that turn produces a persisted assistant
 * message.
 *
 * One row per (batch × target): the body is duplicated per target so that
 * consumption is a single-row write, with no shared array for a buffered
 * job-child write to clobber.
 *
 * Migration ID: add-chat-informs-table-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';

export const addChatInformsTableMigration: Migration = {
  id: 'add-chat-informs-table-v1',
  description: 'Create chat_informs table for out-of-character passages handed to LLM seats',
  introducedInVersion: '4.10.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    return !sqliteTableExists('chat_informs');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      db.exec(
        `CREATE TABLE IF NOT EXISTS "chat_informs" (
          "id" TEXT PRIMARY KEY,
          "chatId" TEXT NOT NULL,
          "batchId" TEXT NOT NULL,
          "participantId" TEXT NOT NULL,
          "contentMarkdown" TEXT NOT NULL,
          "recordMessageId" TEXT,
          "createdAt" TEXT NOT NULL,
          "updatedAt" TEXT NOT NULL,
          "consumedAt" TEXT,
          "consumedByMessageId" TEXT,
          FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE CASCADE
        )`
      );

      db.exec(
        `CREATE INDEX IF NOT EXISTS "idx_chat_informs_pending" ON "chat_informs" ("chatId", "participantId", "consumedAt")`
      );

      db.exec(
        `CREATE INDEX IF NOT EXISTS "idx_chat_informs_batch" ON "chat_informs" ("batchId")`
      );

      db.exec(
        `CREATE INDEX IF NOT EXISTS "idx_chat_informs_consumedBy" ON "chat_informs" ("consumedByMessageId")`
      );

      logger.info('Created chat_informs table', {
        context: 'migration.add-chat-informs-table',
      });

      const durationMs = Date.now() - startTime;

      return {
        id: 'add-chat-informs-table-v1',
        success: true,
        itemsAffected: 1,
        message: 'Created chat_informs table',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to create chat_informs table', {
        context: 'migration.add-chat-informs-table',
        error: errorMessage,
      });

      return {
        id: 'add-chat-informs-table-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to create chat_informs table',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
