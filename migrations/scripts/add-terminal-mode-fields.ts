/**
 * Migration: Add Terminal Mode Fields
 *
 * Adds Terminal Mode persistence fields to the chats table so the salon UI can
 * remember a chat's terminal split-pane state across reloads:
 *   - terminalMode (TEXT, default 'normal') — 'normal' | 'split' | 'focus'
 *   - activeTerminalSessionId (TEXT, nullable) — bound terminal session UUID
 *   - rightPaneVerticalSplit (INTEGER, default 50) — vertical divider position
 *     for the right pane when both Document Mode and Terminal Mode are active
 *
 * Migration ID: add-terminal-mode-fields-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addTerminalModeFieldsMigration: Migration = {
  id: 'add-terminal-mode-fields-v1',
  description: 'Add terminal mode fields to chats table',
  introducedInVersion: '4.5.0',
  dependsOn: ['add-document-mode-fields-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chats')) {
      return false;
    }

    const columns = getSQLiteTableColumns('chats').map((col) => col.name);
    return (
      !columns.includes('terminalMode') ||
      !columns.includes('activeTerminalSessionId') ||
      !columns.includes('rightPaneVerticalSplit')
    );
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let itemsAffected = 0;

    try {
      const db = getSQLiteDatabase();
      const columnNames = getSQLiteTableColumns('chats').map((col) => col.name);

      if (!columnNames.includes('terminalMode')) {
        db.exec(`ALTER TABLE "chats" ADD COLUMN "terminalMode" TEXT DEFAULT 'normal'`);
        itemsAffected++;
        logger.info('Added terminalMode column to chats table', {
          context: 'migration.add-terminal-mode-fields',
        });
      }

      if (!columnNames.includes('activeTerminalSessionId')) {
        db.exec(`ALTER TABLE "chats" ADD COLUMN "activeTerminalSessionId" TEXT`);
        itemsAffected++;
        logger.info('Added activeTerminalSessionId column to chats table', {
          context: 'migration.add-terminal-mode-fields',
        });
      }

      if (!columnNames.includes('rightPaneVerticalSplit')) {
        db.exec(`ALTER TABLE "chats" ADD COLUMN "rightPaneVerticalSplit" INTEGER DEFAULT 50`);
        itemsAffected++;
        logger.info('Added rightPaneVerticalSplit column to chats table', {
          context: 'migration.add-terminal-mode-fields',
        });
      }

      const durationMs = Date.now() - startTime;

      return {
        id: 'add-terminal-mode-fields-v1',
        success: true,
        itemsAffected,
        message: `Added terminal mode fields: ${itemsAffected} change(s)`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add terminal mode fields', {
        context: 'migration.add-terminal-mode-fields',
        error: errorMessage,
      });

      return {
        id: 'add-terminal-mode-fields-v1',
        success: false,
        itemsAffected,
        message: 'Failed to add terminal mode fields',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
