/**
 * Migration: Add Character Avatars Fields to Chats
 *
 * Adds characterAvatars (JSON) and avatarGenerationEnabled (boolean) fields
 * to the chats table for per-conversation avatar generation based on equipped
 * wardrobe items.
 *
 * Migration ID: add-character-avatars-fields-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addCharacterAvatarsFieldsMigration: Migration = {
  id: 'add-character-avatars-fields-v1',
  description: 'Add characterAvatars and avatarGenerationEnabled fields to chats table',
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
    const columnNames = columns.map((col) => col.name);

    return !columnNames.includes('characterAvatars');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      if (sqliteTableExists('chats')) {
        const columns = getSQLiteTableColumns('chats');
        const columnNames = columns.map((col) => col.name);

        if (!columnNames.includes('characterAvatars')) {
          db.exec(`ALTER TABLE "chats" ADD COLUMN "characterAvatars" TEXT DEFAULT NULL`);
          columnsAdded++;
          logger.info('Added characterAvatars column to chats table', {
            context: 'migration.add-character-avatars-fields',
          });
        }

        if (!columnNames.includes('avatarGenerationEnabled')) {
          db.exec(`ALTER TABLE "chats" ADD COLUMN "avatarGenerationEnabled" INTEGER DEFAULT NULL`);
          columnsAdded++;
          logger.info('Added avatarGenerationEnabled column to chats table', {
            context: 'migration.add-character-avatars-fields',
          });
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('Character avatars fields migration completed', {
        context: 'migration.add-character-avatars-fields',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-character-avatars-fields-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} column(s) to chats table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add character avatars fields', {
        context: 'migration.add-character-avatars-fields',
        error: errorMessage,
      });

      return {
        id: 'add-character-avatars-fields-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add character avatars fields',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
