/**
 * Migration: Add Rendered Markdown Field
 *
 * This migration adds a renderedMarkdown field to the chats table:
 * - renderedMarkdown (TEXT, nullable) - Deterministic Markdown rendering of conversations
 *
 * This field supports the Scriptorium conversation rendering functionality.
 *
 * Migration ID: add-rendered-markdown-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

/**
 * Add Rendered Markdown Field Migration
 */
export const addRenderedMarkdownFieldMigration: Migration = {
  id: 'add-rendered-markdown-field-v1',
  description: 'Add renderedMarkdown field to chats table for Scriptorium conversation rendering',
  introducedInVersion: '4.3.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    // Only run for SQLite backend
    if (!isSQLiteBackend()) {
      return false;
    }

    // Check if the chats table is missing the renderedMarkdown column
    if (!sqliteTableExists('chats')) {
      return false;
    }

    const columns = getSQLiteTableColumns('chats');
    const columnNames = columns.map((col) => col.name);

    return !columnNames.includes('renderedMarkdown');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      if (sqliteTableExists('chats')) {
        const chatColumns = getSQLiteTableColumns('chats');
        const chatColumnNames = chatColumns.map((col) => col.name);

        if (!chatColumnNames.includes('renderedMarkdown')) {
          db.exec(`ALTER TABLE "chats" ADD COLUMN "renderedMarkdown" TEXT DEFAULT NULL`);
          columnsAdded++;
          logger.info('Added renderedMarkdown column to chats table', {
            context: 'migration.add-rendered-markdown-field',
          });
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('Added rendered markdown field to chats table', {
        context: 'migration.add-rendered-markdown-field',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-rendered-markdown-field-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} rendered markdown column(s) to chats table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add rendered markdown field', {
        context: 'migration.add-rendered-markdown-field',
        error: errorMessage,
      });

      return {
        id: 'add-rendered-markdown-field-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add rendered markdown field',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
