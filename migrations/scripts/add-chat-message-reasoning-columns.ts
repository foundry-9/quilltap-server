/**
 * Migration: Add Chat Message Reasoning Columns
 *
 * Adds two columns to the chat_messages table for storing reasoning models'
 * chain-of-thought ("thinking"), introduced with the Salon thinking-display
 * feature:
 * - reasoningContent (TEXT, nullable) - full concatenated reasoning for the turn
 * - reasoningSegments (TEXT, nullable) - JSON array of positioned reasoning
 *   blocks ({ anchorOffset, content, seq }) for splicing into the prose
 *
 * Both are DISPLAY ONLY — captured solely so the Salon can show the model's
 * thinking. They are never re-fed to any model as history, summary, or memory.
 *
 * It also converts any empty strings stored in reasoningSegments to NULL so a
 * read never hits a JSON parse error.
 *
 * Migration ID: add-chat-message-reasoning-columns-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addChatMessageReasoningColumnsMigration: Migration = {
  id: 'add-chat-message-reasoning-columns-v1',
  description: 'Add reasoningContent and reasoningSegments columns to chat_messages',
  introducedInVersion: '4.6.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chat_messages')) {
      return false;
    }

    const columnNames = getSQLiteTableColumns('chat_messages').map((col) => col.name);
    return !columnNames.includes('reasoningContent') || !columnNames.includes('reasoningSegments');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;
    let rowsFixed = 0;

    try {
      const db = getSQLiteDatabase();

      if (sqliteTableExists('chat_messages')) {
        const columnNames = getSQLiteTableColumns('chat_messages').map((col) => col.name);

        if (!columnNames.includes('reasoningContent')) {
          db.exec(`ALTER TABLE "chat_messages" ADD COLUMN "reasoningContent" TEXT DEFAULT NULL`);
          columnsAdded++;
          logger.info('Added reasoningContent column to chat_messages table', {
            context: 'migration.add-chat-message-reasoning-columns',
          });
        }

        if (!columnNames.includes('reasoningSegments')) {
          db.exec(`ALTER TABLE "chat_messages" ADD COLUMN "reasoningSegments" TEXT DEFAULT NULL`);
          columnsAdded++;
          logger.info('Added reasoningSegments column to chat_messages table', {
            context: 'migration.add-chat-message-reasoning-columns',
          });
        }

        // Guard against empty strings in the JSON column (would break JSON.parse on read)
        const currentColumns = getSQLiteTableColumns('chat_messages').map((c) => c.name);
        if (currentColumns.includes('reasoningSegments')) {
          const result = db.prepare(
            `UPDATE "chat_messages" SET "reasoningSegments" = NULL WHERE "reasoningSegments" = ''`
          ).run();
          if (result.changes > 0) {
            rowsFixed += result.changes;
            logger.info(`Fixed ${result.changes} empty string(s) in reasoningSegments column`, {
              context: 'migration.add-chat-message-reasoning-columns',
            });
          }
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('Completed chat_messages reasoning-columns update', {
        context: 'migration.add-chat-message-reasoning-columns',
        columnsAdded,
        rowsFixed,
        durationMs,
      });

      return {
        id: 'add-chat-message-reasoning-columns-v1',
        success: true,
        itemsAffected: columnsAdded + rowsFixed,
        message: `Added ${columnsAdded} column(s), fixed ${rowsFixed} empty JSON string(s)`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add chat_messages reasoning columns', {
        context: 'migration.add-chat-message-reasoning-columns',
        error: errorMessage,
      });

      return {
        id: 'add-chat-message-reasoning-columns-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add chat_messages reasoning columns',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
