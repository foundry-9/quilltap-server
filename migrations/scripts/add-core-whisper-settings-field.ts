/**
 * Migration: Add Aurora Core whisper global-default column to chat_settings
 *
 * The `add-core-whisper-fields-v1` migration added the per-chat and
 * per-character override columns (`chats.coreWhisperEnabled`,
 * `chats.coreWhisperInterval`, `characters.coreWhisperEnabled`) but never added
 * the global-default settings column on `chat_settings`. The `ChatSettings`
 * schema and repository both expect a `coreWhisper` JSON column there
 * (resolution precedence: chat → character → global), so without it every write
 * to chat settings fails with `no such column: coreWhisper`.
 *
 * `chat_settings`:
 *  - coreWhisper TEXT DEFAULT '{"enabled":true,"interval":12,"silenceThreshold":3,"packetTokenBudget":4096,"fireOnContextTransition":true}'
 *
 * Migration ID: add-core-whisper-settings-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

const CORE_WHISPER_DEFAULT =
  '{"enabled":true,"interval":12,"silenceThreshold":3,"packetTokenBudget":4096,"fireOnContextTransition":true}';

export const addCoreWhisperSettingsFieldMigration: Migration = {
  id: 'add-core-whisper-settings-field-v1',
  description: 'Add coreWhisper global-default column to chat_settings',
  introducedInVersion: '4.6.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chat_settings')) {
      return false;
    }

    const columns = getSQLiteTableColumns('chat_settings').map((c) => c.name);
    return !columns.includes('coreWhisper');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      const columns = new Set(getSQLiteTableColumns('chat_settings').map((c) => c.name));
      if (!columns.has('coreWhisper')) {
        db.exec(
          `ALTER TABLE "chat_settings" ADD COLUMN "coreWhisper" TEXT DEFAULT '${CORE_WHISPER_DEFAULT}'`
        );
        columnsAdded++;
      }

      const durationMs = Date.now() - startTime;

      logger.info('Added coreWhisper global-default column to chat_settings', {
        context: 'migration.add-core-whisper-settings-field',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-core-whisper-settings-field-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} coreWhisper column to chat_settings`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add coreWhisper column to chat_settings', {
        context: 'migration.add-core-whisper-settings-field',
        error: errorMessage,
      });

      return {
        id: 'add-core-whisper-settings-field-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add coreWhisper column to chat_settings',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
