/**
 * Migration: Create Conversation Tables
 *
 * Creates the conversation_annotations and conversation_chunks tables for
 * Project Scriptorium.
 *
 * - conversation_annotations: Stores per-message annotations by character
 * - conversation_chunks: Stores interchange chunks with optional embeddings
 *
 * This migration runs for existing SQLite installations to add the new tables.
 * New installations get these tables from sqlite-initial-schema.
 *
 * Migration ID: create-conversation-tables-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';

/**
 * Create Conversation Tables Migration
 */
export const createConversationTablesMigration: Migration = {
  id: 'create-conversation-tables-v1',
  description: 'Create conversation_annotations and conversation_chunks tables for Scriptorium',
  introducedInVersion: '4.3.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    // Only run for SQLite backend
    if (!isSQLiteBackend()) {
      return false;
    }

    // Check if either table is missing
    const annotationsExists = sqliteTableExists('conversation_annotations');
    const chunksExists = sqliteTableExists('conversation_chunks');

    return !annotationsExists || !chunksExists;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let tablesCreated = 0;
    let indexesCreated = 0;

    try {
      const db = getSQLiteDatabase();

      // Create tables in a transaction
      const createTables = db.transaction(() => {
        // Create conversation_annotations table
        if (!sqliteTableExists('conversation_annotations')) {
          db.exec(`CREATE TABLE IF NOT EXISTS "conversation_annotations" (
            "id" TEXT PRIMARY KEY,
            "chatId" TEXT NOT NULL,
            "messageIndex" INTEGER NOT NULL,
            "sourceMessageId" TEXT,
            "characterName" TEXT NOT NULL,
            "content" TEXT NOT NULL,
            "createdAt" TEXT NOT NULL,
            "updatedAt" TEXT NOT NULL,
            UNIQUE("chatId", "messageIndex", "characterName")
          )`);
          tablesCreated++;

          // Create indexes
          db.exec(`CREATE INDEX IF NOT EXISTS "idx_conversation_annotations_chatId" ON "conversation_annotations" ("chatId")`);
          indexesCreated += 1;

          logger.info('Created conversation_annotations table', {
            context: 'migration.create-conversation-tables',
          });
        }

        // Create conversation_chunks table
        if (!sqliteTableExists('conversation_chunks')) {
          db.exec(`CREATE TABLE IF NOT EXISTS "conversation_chunks" (
            "id" TEXT PRIMARY KEY,
            "chatId" TEXT NOT NULL,
            "interchangeIndex" INTEGER NOT NULL,
            "content" TEXT NOT NULL,
            "participantNames" TEXT DEFAULT '[]',
            "messageIds" TEXT DEFAULT '[]',
            "embedding" BLOB DEFAULT NULL,
            "createdAt" TEXT NOT NULL,
            "updatedAt" TEXT NOT NULL,
            UNIQUE("chatId", "interchangeIndex")
          )`);
          tablesCreated++;

          // Create indexes
          db.exec(`CREATE INDEX IF NOT EXISTS "idx_conversation_chunks_chatId" ON "conversation_chunks" ("chatId")`);
          indexesCreated += 1;

          logger.info('Created conversation_chunks table', {
            context: 'migration.create-conversation-tables',
          });
        }
      });

      createTables();

      const durationMs = Date.now() - startTime;

      logger.info('Conversation tables migration completed', {
        context: 'migration.create-conversation-tables',
        tablesCreated,
        indexesCreated,
        durationMs,
      });

      return {
        id: 'create-conversation-tables-v1',
        success: true,
        itemsAffected: tablesCreated + indexesCreated,
        message: `Created ${tablesCreated} tables and ${indexesCreated} indexes`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Conversation tables migration failed', {
        context: 'migration.create-conversation-tables',
        error: errorMessage,
      });

      return {
        id: 'create-conversation-tables-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to create conversation tables',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
