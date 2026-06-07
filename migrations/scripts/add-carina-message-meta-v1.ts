/**
 * Migration: Add Carina Message Meta
 *
 * Adds the `carinaMeta` column to the chat_messages table. It holds the
 * JSON provenance for Carina (inline LLM query) reference answers:
 * `{ answererId, question }`. `answererId` drives avatar resolution (the
 * answerer's own avatar) and "prior Carina exchanges" continuity;
 * `question` is the verbatim text asked, stored so those Q/A pairs can be
 * replayed without pulling in the full chat history.
 *
 * NULL on every non-Carina message.
 *
 * Migration ID: add-carina-message-meta-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addCarinaMessageMetaMigration: Migration = {
  id: 'add-carina-message-meta-v1',
  description: 'Add carinaMeta column to chat_messages table',
  introducedInVersion: '4.7.0',
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
    return !columnNames.includes('carinaMeta');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      // JSON: { answererId, question }; NULL on every non-Carina message
      db.exec(`ALTER TABLE "chat_messages" ADD COLUMN "carinaMeta" TEXT DEFAULT NULL`);

      const durationMs = Date.now() - startTime;

      logger.info('Added carinaMeta column to chat_messages table', {
        context: 'migration.add-carina-message-meta',
        durationMs,
      });

      return {
        id: 'add-carina-message-meta-v1',
        success: true,
        itemsAffected: 1,
        message: 'Added carinaMeta column to chat_messages table',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add carinaMeta field', {
        context: 'migration.add-carina-message-meta',
        error: errorMessage,
      });

      return {
        id: 'add-carina-message-meta-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to add carinaMeta field',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
