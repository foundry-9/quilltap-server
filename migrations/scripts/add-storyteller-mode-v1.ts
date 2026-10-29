/**
 * Migration: Storyteller mode storage.
 *
 * - `chats.turnMode` (TEXT, NULL reads as 'rotation'): 'rotation' or
 *   'storyteller'. Patch-only in the repository.
 * - `chats.storytellerInviteFilter` (INTEGER 0/1, default 0): invite each seat
 *   with a probability weighted by talkativeness instead of inviting everyone.
 * - `chat_messages.storytellerBid` (TEXT JSON, NULL): the bid a storyteller
 *   speaking turn carried out — round, tier, plan, tools named — re-applied on
 *   swipe and regenerate.
 * - `storyteller_rounds`: one row per round while it is open; its bids are
 *   cleared when it closes. Not exported or backed up — bids are not part of
 *   the record.
 *
 * No backfill: every existing chat reads as rotation, and no existing message
 * carried a bid. Design of record: docs/developer/features/complete/storyteller-mode.md.
 *
 * Migration ID: add-storyteller-mode-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
} from '../lib/database-utils';

const MIGRATION_ID = 'add-storyteller-mode-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;

export const addStorytellerModeMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Add chats.turnMode, chats.storytellerInviteFilter, chat_messages.storytellerBid and the storyteller_rounds table',
  introducedInVersion: '4.11.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('chats') || !sqliteTableExists('chat_messages')) return false;
    return (
      !sqliteColumnExists('chats', 'turnMode') ||
      !sqliteColumnExists('chats', 'storytellerInviteFilter') ||
      !sqliteColumnExists('chat_messages', 'storytellerBid') ||
      !sqliteTableExists('storyteller_rounds')
    );
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let itemsAffected = 0;
    try {
      if (addColumnIfMissing('chats', 'turnMode', 'TEXT DEFAULT NULL')) {
        itemsAffected++;
        logger.info('Added chats.turnMode column', { context: LOG_CONTEXT });
      }
      if (addColumnIfMissing('chats', 'storytellerInviteFilter', 'INTEGER DEFAULT 0')) {
        itemsAffected++;
        logger.info('Added chats.storytellerInviteFilter column', { context: LOG_CONTEXT });
      }
      if (addColumnIfMissing('chat_messages', 'storytellerBid', 'TEXT DEFAULT NULL')) {
        itemsAffected++;
        logger.info('Added chat_messages.storytellerBid column', { context: LOG_CONTEXT });
      }
      if (!sqliteTableExists('storyteller_rounds')) {
        const db = getSQLiteDatabase();
        db.exec(
          `CREATE TABLE IF NOT EXISTS "storyteller_rounds" (
            "id" TEXT PRIMARY KEY,
            "chatId" TEXT NOT NULL,
            "triggerMessageId" TEXT,
            "status" TEXT NOT NULL,
            "bids" TEXT DEFAULT '[]',
            "selection" TEXT DEFAULT NULL,
            "closedReason" TEXT DEFAULT NULL,
            "createdAt" TEXT NOT NULL,
            "updatedAt" TEXT NOT NULL,
            "closedAt" TEXT DEFAULT NULL,
            FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE CASCADE
          )`
        );
        db.exec(
          `CREATE INDEX IF NOT EXISTS "idx_storyteller_rounds_chat" ON "storyteller_rounds" ("chatId", "status")`
        );
        itemsAffected++;
        logger.info('Created storyteller_rounds table', { context: LOG_CONTEXT });
      }
      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected,
        message: `Storyteller mode storage in place (${itemsAffected} changes)`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Storyteller-mode migration failed', { context: LOG_CONTEXT, error: errorMessage });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected,
        message: `Storyteller-mode migration failed: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
