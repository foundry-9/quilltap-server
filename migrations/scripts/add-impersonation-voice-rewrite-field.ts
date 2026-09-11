/**
 * Migration: Add impersonationVoiceRewrite Field to Chat Settings
 *
 * This migration adds an impersonationVoiceRewrite INTEGER field to the
 * chat_settings table. When enabled (off by default), a line typed while
 * impersonating a character is first restated by that character's own model
 * for review before it posts to the Salon.
 *
 * Migration ID: add-impersonation-voice-rewrite-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addImpersonationVoiceRewriteFieldMigration: Migration = {
  id: 'add-impersonation-voice-rewrite-field-v1',
  description:
    'Add impersonationVoiceRewrite field to chat_settings table for the impersonated-line voice rewrite toggle',
  introducedInVersion: '4.10.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chat_settings')) {
      return false;
    }

    const columns = getSQLiteTableColumns('chat_settings');
    const columnNames = columns.map((col) => col.name);

    return !columnNames.includes('impersonationVoiceRewrite');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      const columns = getSQLiteTableColumns('chat_settings');
      const columnNames = columns.map((col) => col.name);

      if (!columnNames.includes('impersonationVoiceRewrite')) {
        db.exec(
          `ALTER TABLE "chat_settings" ADD COLUMN "impersonationVoiceRewrite" INTEGER DEFAULT 0`,
        );
        columnsAdded++;
        logger.info('Added impersonationVoiceRewrite column to chat_settings table', {
          context: 'migration.add-impersonation-voice-rewrite-field',
        });
      }

      const durationMs = Date.now() - startTime;

      return {
        id: 'add-impersonation-voice-rewrite-field-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added impersonationVoiceRewrite column to chat_settings table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add impersonationVoiceRewrite column', {
        context: 'migration.add-impersonation-voice-rewrite-field',
        error: errorMessage,
      });

      return {
        id: 'add-impersonation-voice-rewrite-field-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add impersonationVoiceRewrite column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
