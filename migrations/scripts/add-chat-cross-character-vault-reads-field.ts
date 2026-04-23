/**
 * Migration: Add allowCrossCharacterVaultReads to Chats
 *
 * Adds a per-chat boolean that, when enabled, permits characters in a
 * multi-character chat to read (read-only) the vaults of other present
 * participants via the `doc_*` tools. Writes always stay scoped to the
 * acting character.
 *
 * Migration ID: add-chat-cross-character-vault-reads-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addChatCrossCharacterVaultReadsFieldMigration: Migration = {
  id: 'add-chat-cross-character-vault-reads-field-v1',
  description: 'Add allowCrossCharacterVaultReads column to chats table',
  introducedInVersion: '4.3.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }
    if (!sqliteTableExists('chats')) {
      return false;
    }
    const columns = getSQLiteTableColumns('chats');
    return !columns.some((col) => col.name === 'allowCrossCharacterVaultReads');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    try {
      const db = getSQLiteDatabase();
      const columns = getSQLiteTableColumns('chats');
      const alreadyExists = columns.some((col) => col.name === 'allowCrossCharacterVaultReads');

      let columnsAdded = 0;
      if (!alreadyExists) {
        db.exec(`ALTER TABLE "chats" ADD COLUMN "allowCrossCharacterVaultReads" INTEGER DEFAULT 0`);
        columnsAdded = 1;
        logger.info('Added allowCrossCharacterVaultReads column to chats table', {
          context: 'migration.add-chat-cross-character-vault-reads-field',
        });
      }

      const durationMs = Date.now() - startTime;

      return {
        id: 'add-chat-cross-character-vault-reads-field-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: columnsAdded
          ? 'Added allowCrossCharacterVaultReads column to chats table'
          : 'allowCrossCharacterVaultReads column already present',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add allowCrossCharacterVaultReads column', {
        context: 'migration.add-chat-cross-character-vault-reads-field',
        error: errorMessage,
      });

      return {
        id: 'add-chat-cross-character-vault-reads-field-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to add allowCrossCharacterVaultReads column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
