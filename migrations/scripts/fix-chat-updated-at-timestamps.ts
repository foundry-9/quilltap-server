/**
 * Migration: Fix Chat Timestamps
 *
 * Background jobs and system events were incorrectly bumping chat timestamps.
 * Two issues:
 * 1. Base repository auto-set updatedAt on every update (fixed in code)
 * 2. addMessage() updated lastMessageAt and updatedAt for system events too (fixed in code)
 *
 * This migration resets both updatedAt and lastMessageAt to the timestamp of
 * the last actual message (type='message'), or falls back to createdAt if the
 * chat has no messages.
 *
 * v1 only fixed updatedAt; v2 also fixes lastMessageAt.
 *
 * Migration ID: fix-chat-updated-at-timestamps-v2
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';

export const fixChatUpdatedAtTimestampsMigration: Migration = {
  id: 'fix-chat-updated-at-timestamps-v2',
  description: 'Reset chat updatedAt and lastMessageAt to last actual message timestamp',
  introducedInVersion: '2.12.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chats') || !sqliteTableExists('chat_messages')) {
      return false;
    }

    // Always run — idempotent (sets timestamps to last actual message time)
    return true;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      // Subquery: the latest actual message timestamp per chat
      const lastMessageSubquery = `
        (
          SELECT MAX(m."createdAt")
          FROM "chat_messages" m
          WHERE m."chatId" = "chats"."id"
            AND m."type" = 'message'
        )
      `;

      // Reset both updatedAt and lastMessageAt to the last actual message time.
      // For chats with no messages, fall back to createdAt.
      db.exec(`
        UPDATE "chats"
        SET
          "updatedAt" = COALESCE(${lastMessageSubquery}, "chats"."createdAt"),
          "lastMessageAt" = COALESCE(${lastMessageSubquery}, "chats"."createdAt")
      `);

      const changes = db.prepare('SELECT changes() as count').get() as { count: number };
      const chatsFixed = changes?.count ?? 0;

      const durationMs = Date.now() - startTime;

      logger.info('Fixed chat timestamps (updatedAt + lastMessageAt)', {
        context: 'migration.fix-chat-updated-at-timestamps',
        chatsFixed,
        durationMs,
      });

      return {
        id: 'fix-chat-updated-at-timestamps-v2',
        success: true,
        itemsAffected: chatsFixed,
        message: `Reset updatedAt and lastMessageAt on ${chatsFixed} chat(s) to last message timestamp`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to fix chat timestamps', {
        context: 'migration.fix-chat-updated-at-timestamps',
        error: errorMessage,
      });

      return {
        id: 'fix-chat-updated-at-timestamps-v2',
        success: false,
        itemsAffected: 0,
        message: 'Failed to fix chat timestamps',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
