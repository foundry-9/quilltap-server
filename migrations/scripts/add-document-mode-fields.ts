/**
 * Migration: Add Document Mode Fields
 *
 * This migration adds document mode support to chats (Scriptorium Phase 3.5):
 * - chats: documentMode (TEXT, default 'normal') — layout state: normal/split/focus
 * - chats: dividerPosition (INTEGER, default 45) — split pane divider position as percentage
 * - chat_documents table — tracks which document is open in each chat
 *
 * Document Mode allows users and LLM participants to collaboratively edit a document
 * alongside the chat conversation in a split-panel layout.
 *
 * Migration ID: add-document-mode-fields-v1
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
 * Add Document Mode Fields Migration
 */
export const addDocumentModeFieldsMigration: Migration = {
  id: 'add-document-mode-fields-v1',
  description: 'Add document mode fields to chats table and create chat_documents table',
  introducedInVersion: '4.3.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    // Check if chats table needs the new columns
    if (sqliteTableExists('chats')) {
      const columns = getSQLiteTableColumns('chats');
      const columnNames = columns.map((col) => col.name);

      if (!columnNames.includes('documentMode') || !columnNames.includes('dividerPosition')) {
        return true;
      }
    }

    // Check if chat_documents table needs to be created
    if (!sqliteTableExists('chat_documents')) {
      return true;
    }

    return false;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let itemsAffected = 0;

    try {
      const db = getSQLiteDatabase();

      // Add documentMode column to chats
      if (sqliteTableExists('chats')) {
        const chatColumns = getSQLiteTableColumns('chats');
        const chatColumnNames = chatColumns.map((col) => col.name);

        if (!chatColumnNames.includes('documentMode')) {
          db.exec(`ALTER TABLE "chats" ADD COLUMN "documentMode" TEXT DEFAULT 'normal'`);
          itemsAffected++;
          logger.info('Added documentMode column to chats table', {
            context: 'migration.add-document-mode-fields',
          });
        }

        if (!chatColumnNames.includes('dividerPosition')) {
          db.exec(`ALTER TABLE "chats" ADD COLUMN "dividerPosition" INTEGER DEFAULT 45`);
          itemsAffected++;
          logger.info('Added dividerPosition column to chats table', {
            context: 'migration.add-document-mode-fields',
          });
        }
      }

      // Create chat_documents table
      if (!sqliteTableExists('chat_documents')) {
        db.exec(`
          CREATE TABLE "chat_documents" (
            "id" TEXT PRIMARY KEY,
            "chatId" TEXT NOT NULL,
            "filePath" TEXT NOT NULL,
            "scope" TEXT NOT NULL DEFAULT 'project',
            "mountPoint" TEXT,
            "displayTitle" TEXT,
            "isActive" INTEGER DEFAULT 1,
            "createdAt" TEXT NOT NULL,
            "updatedAt" TEXT NOT NULL
          )
        `);
        db.exec(`CREATE INDEX "idx_chat_documents_chatId" ON "chat_documents" ("chatId")`);
        db.exec(`CREATE UNIQUE INDEX "idx_chat_documents_unique" ON "chat_documents" ("chatId", "filePath", "scope", "mountPoint")`);
        itemsAffected++;
        logger.info('Created chat_documents table', {
          context: 'migration.add-document-mode-fields',
        });
      }

      const durationMs = Date.now() - startTime;

      logger.info('Added document mode fields', {
        context: 'migration.add-document-mode-fields',
        itemsAffected,
        durationMs,
      });

      return {
        id: 'add-document-mode-fields-v1',
        success: true,
        itemsAffected,
        message: `Added document mode fields: ${itemsAffected} change(s)`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add document mode fields', {
        context: 'migration.add-document-mode-fields',
        error: errorMessage,
      });

      return {
        id: 'add-document-mode-fields-v1',
        success: false,
        itemsAffected,
        message: 'Failed to add document mode fields',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
