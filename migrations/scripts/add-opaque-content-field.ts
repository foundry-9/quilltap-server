/**
 * Migration: Add Opaque Content Field
 *
 * Adds the opaqueContent column to chat_messages. Stores a neutral, persona-
 * free rewrite of `content` for Staff-authored messages (systemSender != null).
 *
 * When a chat has any non-user-character participant whose
 * `systemTransparency !== true`, the context-builder swaps `content` →
 * `opaqueContent ?? content` in every character's LLM context. The user
 * character does NOT count toward the test — they stay "transparent by
 * default". The human user's transcript / UI is unaffected.
 *
 * NULL on participant-authored messages and on Staff messages written before
 * this migration (in which case the swap falls through to `content`).
 *
 * Migration ID: add-opaque-content-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addOpaqueContentFieldMigration: Migration = {
  id: 'add-opaque-content-field-v1',
  description: 'Add opaqueContent column to chat_messages for per-chat opaque-anywhere Staff voicing',
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

    return !columnNames.includes('opaqueContent');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      db.exec(`ALTER TABLE "chat_messages" ADD COLUMN "opaqueContent" TEXT DEFAULT NULL`);

      logger.info('Added opaqueContent column to chat_messages table', {
        context: 'migration.add-opaque-content-field',
      });

      const durationMs = Date.now() - startTime;

      return {
        id: 'add-opaque-content-field-v1',
        success: true,
        itemsAffected: 1,
        message: 'Added opaqueContent column to chat_messages',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add opaqueContent column', {
        context: 'migration.add-opaque-content-field',
        error: errorMessage,
      });

      return {
        id: 'add-opaque-content-field-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to add opaqueContent column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
