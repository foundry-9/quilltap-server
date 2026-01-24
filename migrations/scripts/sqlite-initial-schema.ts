/**
 * SQLite Initial Schema Migration
 *
 * Creates all the necessary tables for SQLite database.
 * This migration runs only when using SQLite backend.
 */

import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';
import type { Migration, MigrationResult } from '../types';

// Define all tables that need to be created for SQLite
const TABLES = [
  // Core entity tables
  {
    name: 'users',
    sql: `CREATE TABLE IF NOT EXISTS "users" (
      "id" TEXT PRIMARY KEY,
      "email" TEXT UNIQUE,
      "emailVerified" TEXT,
      "passwordHash" TEXT,
      "totpSecret" TEXT,
      "totpEnabled" INTEGER DEFAULT 0,
      "generalSettings" TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_users_email" ON "users" ("email")`,
    ],
  },
  {
    name: 'accounts',
    sql: `CREATE TABLE IF NOT EXISTS "accounts" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "type" TEXT NOT NULL,
      "provider" TEXT NOT NULL,
      "providerAccountId" TEXT NOT NULL,
      "refresh_token" TEXT,
      "access_token" TEXT,
      "expires_at" INTEGER,
      "token_type" TEXT,
      "scope" TEXT,
      "id_token" TEXT,
      "session_state" TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL,
      UNIQUE("provider", "providerAccountId")
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_accounts_userId" ON "accounts" ("userId")`,
    ],
  },
  {
    name: 'sessions',
    sql: `CREATE TABLE IF NOT EXISTS "sessions" (
      "id" TEXT PRIMARY KEY,
      "sessionToken" TEXT UNIQUE NOT NULL,
      "userId" TEXT NOT NULL,
      "expires" TEXT NOT NULL,
      "deviceInfo" TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_sessions_userId" ON "sessions" ("userId")`,
      `CREATE INDEX IF NOT EXISTS "idx_sessions_sessionToken" ON "sessions" ("sessionToken")`,
    ],
  },
  {
    name: 'characters',
    sql: `CREATE TABLE IF NOT EXISTS "characters" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "description" TEXT,
      "personality" TEXT,
      "scenario" TEXT,
      "greeting" TEXT,
      "exampleMessages" TEXT,
      "creatorNotes" TEXT,
      "systemPrompts" TEXT,
      "physicalDescriptions" TEXT,
      "personaLinks" TEXT,
      "avatarOverrides" TEXT,
      "defaultImageId" TEXT,
      "controlledBy" TEXT DEFAULT 'llm',
      "isFavorite" INTEGER DEFAULT 0,
      "talkativeness" REAL DEFAULT 0.5,
      "tags" TEXT DEFAULT '[]',
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_characters_userId" ON "characters" ("userId")`,
      `CREATE INDEX IF NOT EXISTS "idx_characters_createdAt" ON "characters" ("createdAt" DESC)`,
    ],
  },
  {
    name: 'chats',
    sql: `CREATE TABLE IF NOT EXISTS "chats" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "title" TEXT,
      "participants" TEXT NOT NULL,
      "roleplayTemplateId" TEXT,
      "connectionProfileId" TEXT,
      "imageProfileId" TEXT,
      "systemPromptOverride" TEXT,
      "isArchived" INTEGER DEFAULT 0,
      "isFavorite" INTEGER DEFAULT 0,
      "isPinned" INTEGER DEFAULT 0,
      "tags" TEXT DEFAULT '[]',
      "tokenUsage" TEXT,
      "contextCompression" TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_chats_userId" ON "chats" ("userId")`,
      `CREATE INDEX IF NOT EXISTS "idx_chats_createdAt" ON "chats" ("createdAt" DESC)`,
    ],
  },
  {
    name: 'chat_messages',
    sql: `CREATE TABLE IF NOT EXISTS "chat_messages" (
      "id" TEXT PRIMARY KEY,
      "chatId" TEXT NOT NULL,
      "participantId" TEXT NOT NULL,
      "content" TEXT NOT NULL,
      "role" TEXT NOT NULL,
      "type" TEXT DEFAULT 'message',
      "attachments" TEXT,
      "toolCalls" TEXT,
      "toolResults" TEXT,
      "metadata" TEXT,
      "tokenCount" INTEGER,
      "isCompressed" INTEGER DEFAULT 0,
      "compressionSummary" TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_chat_messages_chatId" ON "chat_messages" ("chatId")`,
      `CREATE INDEX IF NOT EXISTS "idx_chat_messages_createdAt" ON "chat_messages" ("createdAt" DESC)`,
    ],
  },
  {
    name: 'memories',
    sql: `CREATE TABLE IF NOT EXISTS "memories" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "characterId" TEXT NOT NULL,
      "content" TEXT NOT NULL,
      "importance" INTEGER DEFAULT 5,
      "source" TEXT DEFAULT 'manual',
      "sourceCharacterId" TEXT,
      "tags" TEXT DEFAULT '[]',
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_memories_userId" ON "memories" ("userId")`,
      `CREATE INDEX IF NOT EXISTS "idx_memories_characterId" ON "memories" ("characterId")`,
    ],
  },
  {
    name: 'tags',
    sql: `CREATE TABLE IF NOT EXISTS "tags" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "nameLower" TEXT NOT NULL,
      "color" TEXT,
      "quickHide" INTEGER DEFAULT 0,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL,
      UNIQUE("userId", "nameLower")
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_tags_userId" ON "tags" ("userId")`,
    ],
  },
  {
    name: 'connection_profiles',
    sql: `CREATE TABLE IF NOT EXISTS "connection_profiles" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "provider" TEXT NOT NULL,
      "model" TEXT NOT NULL,
      "apiKey" TEXT,
      "baseUrl" TEXT,
      "temperature" REAL DEFAULT 1.0,
      "maxTokens" INTEGER,
      "topP" REAL DEFAULT 1.0,
      "frequencyPenalty" REAL DEFAULT 0,
      "presencePenalty" REAL DEFAULT 0,
      "isDefault" INTEGER DEFAULT 0,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_connection_profiles_userId" ON "connection_profiles" ("userId")`,
    ],
  },
  {
    name: 'image_profiles',
    sql: `CREATE TABLE IF NOT EXISTS "image_profiles" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "provider" TEXT NOT NULL,
      "model" TEXT NOT NULL,
      "apiKey" TEXT,
      "baseUrl" TEXT,
      "width" INTEGER DEFAULT 1024,
      "height" INTEGER DEFAULT 1024,
      "steps" INTEGER,
      "guidance" REAL,
      "isDefault" INTEGER DEFAULT 0,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_image_profiles_userId" ON "image_profiles" ("userId")`,
    ],
  },
  {
    name: 'embedding_profiles',
    sql: `CREATE TABLE IF NOT EXISTS "embedding_profiles" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "provider" TEXT NOT NULL,
      "model" TEXT NOT NULL,
      "apiKey" TEXT,
      "baseUrl" TEXT,
      "dimensions" INTEGER,
      "isDefault" INTEGER DEFAULT 0,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_embedding_profiles_userId" ON "embedding_profiles" ("userId")`,
    ],
  },
  {
    name: 'files',
    sql: `CREATE TABLE IF NOT EXISTS "files" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "filename" TEXT NOT NULL,
      "mimeType" TEXT NOT NULL,
      "size" INTEGER NOT NULL,
      "sha256" TEXT,
      "s3Key" TEXT NOT NULL,
      "category" TEXT DEFAULT 'general',
      "source" TEXT DEFAULT 'upload',
      "linkedEntityId" TEXT,
      "linkedEntityType" TEXT,
      "metadata" TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_files_userId" ON "files" ("userId")`,
      `CREATE INDEX IF NOT EXISTS "idx_files_sha256" ON "files" ("sha256")`,
    ],
  },
  {
    name: 'folders',
    sql: `CREATE TABLE IF NOT EXISTS "folders" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "parentId" TEXT,
      "mountPointId" TEXT,
      "path" TEXT NOT NULL,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_folders_userId" ON "folders" ("userId")`,
      `CREATE INDEX IF NOT EXISTS "idx_folders_parentId" ON "folders" ("parentId")`,
    ],
  },
  {
    name: 'roleplay_templates',
    sql: `CREATE TABLE IF NOT EXISTS "roleplay_templates" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "description" TEXT,
      "systemPrompt" TEXT NOT NULL,
      "isBuiltIn" INTEGER DEFAULT 0,
      "isDefault" INTEGER DEFAULT 0,
      "pluginId" TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_roleplay_templates_userId" ON "roleplay_templates" ("userId")`,
    ],
  },
  {
    name: 'prompt_templates',
    sql: `CREATE TABLE IF NOT EXISTS "prompt_templates" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "content" TEXT NOT NULL,
      "category" TEXT DEFAULT 'general',
      "isDefault" INTEGER DEFAULT 0,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_prompt_templates_userId" ON "prompt_templates" ("userId")`,
    ],
  },
  {
    name: 'chat_settings',
    sql: `CREATE TABLE IF NOT EXISTS "chat_settings" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "settings" TEXT NOT NULL,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL,
      UNIQUE("userId")
    )`,
    indexes: [],
  },
  {
    name: 'background_jobs',
    sql: `CREATE TABLE IF NOT EXISTS "background_jobs" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT,
      "type" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "progress" INTEGER DEFAULT 0,
      "data" TEXT,
      "result" TEXT,
      "error" TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL,
      "startedAt" TEXT,
      "completedAt" TEXT
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_background_jobs_userId" ON "background_jobs" ("userId")`,
      `CREATE INDEX IF NOT EXISTS "idx_background_jobs_status" ON "background_jobs" ("status")`,
    ],
  },
  {
    name: 'llm_logs',
    sql: `CREATE TABLE IF NOT EXISTS "llm_logs" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "chatId" TEXT,
      "provider" TEXT NOT NULL,
      "model" TEXT NOT NULL,
      "requestType" TEXT NOT NULL,
      "inputTokens" INTEGER,
      "outputTokens" INTEGER,
      "totalTokens" INTEGER,
      "latencyMs" INTEGER,
      "success" INTEGER DEFAULT 1,
      "errorMessage" TEXT,
      "requestData" TEXT,
      "responseData" TEXT,
      "createdAt" TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_llm_logs_userId" ON "llm_logs" ("userId")`,
      `CREATE INDEX IF NOT EXISTS "idx_llm_logs_chatId" ON "llm_logs" ("chatId")`,
      `CREATE INDEX IF NOT EXISTS "idx_llm_logs_createdAt" ON "llm_logs" ("createdAt" DESC)`,
    ],
  },
  {
    name: 'plugin_configs',
    sql: `CREATE TABLE IF NOT EXISTS "plugin_configs" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT,
      "pluginId" TEXT NOT NULL,
      "config" TEXT NOT NULL,
      "enabled" INTEGER DEFAULT 1,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL,
      UNIQUE("userId", "pluginId")
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_plugin_configs_pluginId" ON "plugin_configs" ("pluginId")`,
    ],
  },
];

export const sqliteInitialSchemaMigration: Migration = {
  id: 'sqlite-initial-schema-v1',
  description: 'Create initial SQLite database schema',
  introducedInVersion: '2.8.0',

  async shouldRun(): Promise<boolean> {
    // Only run for SQLite backend
    if (!isSQLiteBackend()) {
      logger.debug('Not running SQLite schema migration - not using SQLite backend', {
        context: 'migrations.sqlite-initial-schema.shouldRun',
      });
      return false;
    }

    // Check if any tables are missing
    for (const table of TABLES) {
      if (!sqliteTableExists(table.name)) {
        logger.debug('Table missing, migration needed', {
          context: 'migrations.sqlite-initial-schema.shouldRun',
          table: table.name,
        });
        return true;
      }
    }

    logger.debug('All SQLite tables exist, migration not needed', {
      context: 'migrations.sqlite-initial-schema.shouldRun',
    });
    return false;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let tablesCreated = 0;
    let indexesCreated = 0;

    try {
      const db = getSQLiteDatabase();

      // Run all table creation and index creation in a transaction
      const createSchema = db.transaction(() => {
        for (const table of TABLES) {
          if (!sqliteTableExists(table.name)) {
            logger.debug('Creating table', {
              context: 'migrations.sqlite-initial-schema.run',
              table: table.name,
            });
            db.exec(table.sql);
            tablesCreated++;

            // Create indexes for this table
            for (const indexSql of table.indexes) {
              db.exec(indexSql);
              indexesCreated++;
            }
          }
        }
      });

      createSchema();

      const durationMs = Date.now() - startTime;

      logger.info('SQLite schema migration completed', {
        context: 'migrations.sqlite-initial-schema.run',
        tablesCreated,
        indexesCreated,
        durationMs,
      });

      return {
        id: 'sqlite-initial-schema-v1',
        success: true,
        itemsAffected: tablesCreated + indexesCreated,
        message: `Created ${tablesCreated} tables and ${indexesCreated} indexes`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('SQLite schema migration failed', {
        context: 'migrations.sqlite-initial-schema.run',
        error: errorMessage,
      });

      return {
        id: 'sqlite-initial-schema-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to create SQLite schema',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
