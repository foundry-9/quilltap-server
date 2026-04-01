/**
 * Migration: Fix Chat Message Counts
 *
 * Chat messageCount was counting ALL records in chat_messages — including
 * system events (DANGER_CLASSIFICATION, MEMORY_EXTRACTION, etc.), SYSTEM
 * role messages (system prompts), TOOL role messages, and context summaries.
 * This inflated the count shown in the UI.
 *
 * This migration resets messageCount to only count visible message bubbles:
 * type='message' with role NOT IN ('SYSTEM', 'TOOL') — i.e., USER and
 * ASSISTANT messages only.
 *
 * Migration ID: fix-chat-message-counts
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';

export const fixChatMessageCountsMigration: Migration = {
  id: 'fix-chat-message-counts',
  description: 'Reset chat messageCount to only count visible message bubbles (USER/ASSISTANT)',
  introducedInVersion: '2.10.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chats') || !sqliteTableExists('chat_messages')) {
      return false;
    }

    // Always run — idempotent (sets counts to visible messages only)
    return true;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      // Reset messageCount to only count visible bubbles (USER and ASSISTANT messages)
      db.exec(`
        UPDATE "chats"
        SET "messageCount" = (
          SELECT COUNT(*)
          FROM "chat_messages"
          WHERE "chat_messages"."chatId" = "chats"."id"
            AND "chat_messages"."type" = 'message'
            AND "chat_messages"."role" NOT IN ('SYSTEM', 'TOOL')
        )
      `);

      const changes = db.prepare('SELECT changes() as count').get() as { count: number };
      const chatsFixed = changes?.count ?? 0;

      const durationMs = Date.now() - startTime;

      logger.info('Fixed chat message counts to visible-only', {
        context: 'migration.fix-chat-message-counts',
        chatsFixed,
        durationMs,
      });

      return {
        id: 'fix-chat-message-counts',
        success: true,
        itemsAffected: chatsFixed,
        message: `Reset messageCount on ${chatsFixed} chat(s) to visible messages only`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to fix chat message counts', {
        context: 'migration.fix-chat-message-counts',
        error: errorMessage,
      });

      return {
        id: 'fix-chat-message-counts',
        success: false,
        itemsAffected: 0,
        message: 'Failed to fix chat message counts',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
