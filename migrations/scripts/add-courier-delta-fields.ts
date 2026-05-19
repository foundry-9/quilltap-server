/**
 * Migration: Add Courier delta-mode fields
 *
 * Three columns to support the delta-mode optimization on The Courier:
 *  - connection_profiles.courierDeltaMode INTEGER DEFAULT 1
 *    When true (default), after a character's first successful Courier turn in
 *    a given chat, subsequent placeholders render only the delta since the
 *    last paste instead of the full context. Desktop LLM clients (Claude
 *    desktop, ChatGPT web, etc.) keep prior conversation themselves, so we
 *    needn't re-establish it.
 *  - chats.courierCheckpoints TEXT DEFAULT NULL
 *    JSON: { [characterId]: { lastResolvedMessageId, resolvedAt } }. Set on
 *    successful resolve-external-turn; consulted by the orchestrator when
 *    rendering the next Courier turn.
 *  - chat_messages.pendingExternalPromptFull TEXT DEFAULT NULL
 *    The full-context fallback bundle. Stored alongside `pendingExternalPrompt`
 *    when delta mode rendered a delta — lets the Salon bubble offer a "Use
 *    full context" toggle for when the user has switched LLM clients or
 *    cleared their desktop conversation.
 *
 * Migration ID: add-courier-delta-fields-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addCourierDeltaFieldsMigration: Migration = {
  id: 'add-courier-delta-fields-v1',
  description: 'Add Courier delta-mode column to connection_profiles, checkpoint column to chats, and full-fallback column to chat_messages',
  introducedInVersion: '4.5.0',
  dependsOn: ['add-courier-transport-fields-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (
      !sqliteTableExists('connection_profiles') ||
      !sqliteTableExists('chats') ||
      !sqliteTableExists('chat_messages')
    ) {
      return false;
    }

    const profileCols = getSQLiteTableColumns('connection_profiles').map((c) => c.name);
    const chatCols = getSQLiteTableColumns('chats').map((c) => c.name);
    const messageCols = getSQLiteTableColumns('chat_messages').map((c) => c.name);

    return (
      !profileCols.includes('courierDeltaMode') ||
      !chatCols.includes('courierCheckpoints') ||
      !messageCols.includes('pendingExternalPromptFull')
    );
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      const profileCols = getSQLiteTableColumns('connection_profiles').map((c) => c.name);
      if (!profileCols.includes('courierDeltaMode')) {
        db.exec(`ALTER TABLE "connection_profiles" ADD COLUMN "courierDeltaMode" INTEGER DEFAULT 1`);
      }

      const chatCols = getSQLiteTableColumns('chats').map((c) => c.name);
      if (!chatCols.includes('courierCheckpoints')) {
        db.exec(`ALTER TABLE "chats" ADD COLUMN "courierCheckpoints" TEXT DEFAULT NULL`);
      }

      const messageCols = getSQLiteTableColumns('chat_messages').map((c) => c.name);
      if (!messageCols.includes('pendingExternalPromptFull')) {
        db.exec(`ALTER TABLE "chat_messages" ADD COLUMN "pendingExternalPromptFull" TEXT DEFAULT NULL`);
      }

      logger.info('Added Courier delta-mode columns', {
        context: 'migration.add-courier-delta-fields',
      });

      return {
        id: 'add-courier-delta-fields-v1',
        success: true,
        itemsAffected: 3,
        message: 'Added Courier delta-mode + checkpoint + full-fallback columns',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add Courier delta-mode columns', {
        context: 'migration.add-courier-delta-fields',
        error: errorMessage,
      });

      return {
        id: 'add-courier-delta-fields-v1',
        success: false,
        itemsAffected: 0,
        message: `Failed to add Courier delta-mode columns: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
