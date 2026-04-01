/**
 * Migration: Add Missing Chat Message Columns
 *
 * This migration adds columns to the chat_messages table that were present
 * in the MessageEventSchema but missing from ChatMessageRowSchema:
 * - renderedHtml (TEXT, nullable) - Server-side pre-rendered HTML
 * - dangerFlags (TEXT, default '[]') - JSON array of danger flag objects
 *
 * It also fixes any empty strings stored in JSON columns (rawResponse,
 * attachments, debugMemoryLogs, dangerFlags) by converting them to NULL,
 * which prevents JSON parse errors on read.
 *
 * Migration ID: add-chat-message-missing-columns-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addChatMessageMissingColumnsMigration: Migration = {
  id: 'add-chat-message-missing-columns-v1',
  description: 'Add renderedHtml and dangerFlags columns to chat_messages, fix empty JSON strings',
  introducedInVersion: '2.13.0',
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

    // Run if missing columns or if we haven't cleaned empty strings yet
    return !columnNames.includes('renderedHtml') || !columnNames.includes('dangerFlags');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;
    let rowsFixed = 0;

    try {
      const db = getSQLiteDatabase();

      if (sqliteTableExists('chat_messages')) {
        const columns = getSQLiteTableColumns('chat_messages');
        const columnNames = columns.map((col) => col.name);

        if (!columnNames.includes('renderedHtml')) {
          db.exec(`ALTER TABLE "chat_messages" ADD COLUMN "renderedHtml" TEXT DEFAULT NULL`);
          columnsAdded++;
          logger.info('Added renderedHtml column to chat_messages table', {
            context: 'migration.add-chat-message-missing-columns',
          });
        }

        if (!columnNames.includes('dangerFlags')) {
          db.exec(`ALTER TABLE "chat_messages" ADD COLUMN "dangerFlags" TEXT DEFAULT NULL`);
          columnsAdded++;
          logger.info('Added dangerFlags column to chat_messages table', {
            context: 'migration.add-chat-message-missing-columns',
          });
        }

        // Fix empty strings in JSON columns — these cause JSON parse errors
        const jsonColumns = ['rawResponse', 'attachments', 'debugMemoryLogs', 'dangerFlags'];
        for (const col of jsonColumns) {
          // Check if column exists before trying to fix it
          const currentColumns = getSQLiteTableColumns('chat_messages');
          const currentColumnNames = currentColumns.map((c) => c.name);
          if (currentColumnNames.includes(col)) {
            const result = db.prepare(
              `UPDATE "chat_messages" SET "${col}" = NULL WHERE "${col}" = ''`
            ).run();
            if (result.changes > 0) {
              rowsFixed += result.changes;
              logger.info(`Fixed ${result.changes} empty string(s) in ${col} column`, {
                context: 'migration.add-chat-message-missing-columns',
              });
            }
          }
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('Completed chat_messages schema update', {
        context: 'migration.add-chat-message-missing-columns',
        columnsAdded,
        rowsFixed,
        durationMs,
      });

      return {
        id: 'add-chat-message-missing-columns-v1',
        success: true,
        itemsAffected: columnsAdded + rowsFixed,
        message: `Added ${columnsAdded} column(s), fixed ${rowsFixed} empty JSON string(s)`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to update chat_messages schema', {
        context: 'migration.add-chat-message-missing-columns',
        error: errorMessage,
      });

      return {
        id: 'add-chat-message-missing-columns-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to update chat_messages schema',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
