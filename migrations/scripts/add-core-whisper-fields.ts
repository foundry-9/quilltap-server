/**
 * Migration: Add Aurora Core whisper fields
 *
 * Three nullable columns powering the Core whisper feature — Aurora's periodic
 * re-offering of each character's own `Core/` vault folder. Resolution
 * precedence on every read is chat override → character override → global
 * default; NULL on these columns means "fall through to the next tier."
 *
 *  - chats.coreWhisperEnabled INTEGER DEFAULT NULL
 *    Per-chat boolean override. NULL = inherit from character / global.
 *  - chats.coreWhisperInterval INTEGER DEFAULT NULL
 *    Per-chat cadence override (assistant turns between whispers). NULL = inherit.
 *  - characters.coreWhisperEnabled INTEGER DEFAULT NULL
 *    Per-character boolean override. NULL = inherit from global.
 *
 * Migration ID: add-core-whisper-fields-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addCoreWhisperFieldsMigration: Migration = {
  id: 'add-core-whisper-fields-v1',
  description: 'Add coreWhisper override columns to chats and characters',
  introducedInVersion: '4.6.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chats') || !sqliteTableExists('characters')) {
      return false;
    }

    const chatCols = getSQLiteTableColumns('chats').map((c) => c.name);
    const characterCols = getSQLiteTableColumns('characters').map((c) => c.name);

    return (
      !chatCols.includes('coreWhisperEnabled') ||
      !chatCols.includes('coreWhisperInterval') ||
      !characterCols.includes('coreWhisperEnabled')
    );
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      const chatCols = getSQLiteTableColumns('chats').map((c) => c.name);
      if (!chatCols.includes('coreWhisperEnabled')) {
        db.exec(`ALTER TABLE "chats" ADD COLUMN "coreWhisperEnabled" INTEGER DEFAULT NULL`);
        columnsAdded++;
      }
      if (!chatCols.includes('coreWhisperInterval')) {
        db.exec(`ALTER TABLE "chats" ADD COLUMN "coreWhisperInterval" INTEGER DEFAULT NULL`);
        columnsAdded++;
      }

      const characterCols = getSQLiteTableColumns('characters').map((c) => c.name);
      if (!characterCols.includes('coreWhisperEnabled')) {
        db.exec(`ALTER TABLE "characters" ADD COLUMN "coreWhisperEnabled" INTEGER DEFAULT NULL`);
        columnsAdded++;
      }

      logger.info('Added Aurora Core whisper override columns', {
        context: 'migration.add-core-whisper-fields',
        columnsAdded,
      });

      return {
        id: 'add-core-whisper-fields-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} core-whisper override column(s)`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add core-whisper override columns', {
        context: 'migration.add-core-whisper-fields',
        error: errorMessage,
      });

      return {
        id: 'add-core-whisper-fields-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: `Failed to add core-whisper override columns: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
