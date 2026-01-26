/**
 * SQLite Initial Schema Migration
 *
 * Creates all the necessary tables for SQLite database.
 * This migration runs only when using SQLite backend (the default for new installations).
 *
 * Existing MongoDB deployments can use the standalone migration CLI tool
 * (scripts/mongo-to-sqlite-cli.js) to migrate their data to SQLite when ready.
 */

import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';
import type { Migration, MigrationResult } from '../types';

// Define all tables that need to be created for SQLite
// Exported so migration service can use it to ensure tables exist before data migration
export const SQLITE_TABLES = [
  // Core entity tables
  {
    name: 'users',
    sql: `CREATE TABLE IF NOT EXISTS "users" (
      "id" TEXT PRIMARY KEY,
      "username" TEXT NOT NULL,
      "email" TEXT UNIQUE,
      "name" TEXT,
      "image" TEXT,
      "emailVerified" TEXT,
      "passwordHash" TEXT,
      "totp" TEXT,
      "backupCodes" TEXT,
      "totpAttempts" TEXT,
      "trustedDevices" TEXT DEFAULT '[]',
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_users_email" ON "users" ("email")`,
      `CREATE INDEX IF NOT EXISTS "idx_users_username" ON "users" ("username")`,
    ],
  },
  // Note: accounts and sessions tables removed (single-user mode)
  {
    name: 'characters',
    sql: `CREATE TABLE IF NOT EXISTS "characters" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "title" TEXT,
      "description" TEXT,
      "personality" TEXT,
      "scenario" TEXT,
      "firstMessage" TEXT,
      "exampleDialogues" TEXT,
      "systemPrompts" TEXT DEFAULT '[]',
      "avatarUrl" TEXT,
      "defaultImageId" TEXT,
      "defaultConnectionProfileId" TEXT,
      "defaultPartnerId" TEXT,
      "defaultRoleplayTemplateId" TEXT,
      "sillyTavernData" TEXT,
      "isFavorite" INTEGER DEFAULT 0,
      "npc" INTEGER DEFAULT 0,
      "talkativeness" REAL DEFAULT 0.5,
      "controlledBy" TEXT DEFAULT 'llm',
      "personaLinks" TEXT DEFAULT '[]',
      "tags" TEXT DEFAULT '[]',
      "avatarOverrides" TEXT DEFAULT '[]',
      "physicalDescriptions" TEXT DEFAULT '[]',
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
      "participants" TEXT DEFAULT '[]',
      "title" TEXT NOT NULL,
      "contextSummary" TEXT,
      "sillyTavernMetadata" TEXT,
      "tags" TEXT DEFAULT '[]',
      "roleplayTemplateId" TEXT,
      "timestampConfig" TEXT,
      "lastTurnParticipantId" TEXT,
      "messageCount" INTEGER DEFAULT 0,
      "lastMessageAt" TEXT,
      "lastRenameCheckInterchange" INTEGER DEFAULT 0,
      "isPaused" INTEGER DEFAULT 0,
      "isManuallyRenamed" INTEGER DEFAULT 0,
      "impersonatingParticipantIds" TEXT DEFAULT '[]',
      "activeTypingParticipantId" TEXT,
      "allLLMPauseTurnCount" INTEGER DEFAULT 0,
      "documentEditingMode" INTEGER DEFAULT 0,
      "projectId" TEXT,
      "totalPromptTokens" INTEGER DEFAULT 0,
      "totalCompletionTokens" INTEGER DEFAULT 0,
      "estimatedCostUSD" REAL,
      "priceSource" TEXT,
      "showSystemEventsOverride" INTEGER,
      "requestFullContextOnNextMessage" INTEGER DEFAULT 0,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_chats_userId" ON "chats" ("userId")`,
      `CREATE INDEX IF NOT EXISTS "idx_chats_createdAt" ON "chats" ("createdAt" DESC)`,
      `CREATE INDEX IF NOT EXISTS "idx_chats_projectId" ON "chats" ("projectId")`,
    ],
  },
  // Chat messages - normalized table (one row per message)
  // MongoDB stores as { chatId, messages: [...] } but SQLite normalizes to individual rows
  {
    name: 'chat_messages',
    sql: `CREATE TABLE IF NOT EXISTS "chat_messages" (
      "id" TEXT PRIMARY KEY,
      "chatId" TEXT NOT NULL,
      "type" TEXT DEFAULT 'message',
      "role" TEXT,
      "content" TEXT,
      "rawResponse" TEXT,
      "tokenCount" INTEGER,
      "promptTokens" INTEGER,
      "completionTokens" INTEGER,
      "swipeGroupId" TEXT,
      "swipeIndex" INTEGER,
      "attachments" TEXT DEFAULT '[]',
      "debugMemoryLogs" TEXT,
      "thoughtSignature" TEXT,
      "participantId" TEXT,
      "recoveryType" TEXT,
      "context" TEXT,
      "systemEventType" TEXT,
      "description" TEXT,
      "totalTokens" INTEGER,
      "provider" TEXT,
      "modelName" TEXT,
      "estimatedCostUSD" REAL,
      "createdAt" TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_chat_messages_chatId" ON "chat_messages" ("chatId")`,
      `CREATE INDEX IF NOT EXISTS "idx_chat_messages_createdAt" ON "chat_messages" ("createdAt" DESC)`,
      `CREATE INDEX IF NOT EXISTS "idx_chat_messages_swipeGroupId" ON "chat_messages" ("swipeGroupId")`,
    ],
  },
  {
    name: 'memories',
    sql: `CREATE TABLE IF NOT EXISTS "memories" (
      "id" TEXT PRIMARY KEY,
      "characterId" TEXT NOT NULL,
      "personaId" TEXT,
      "aboutCharacterId" TEXT,
      "chatId" TEXT,
      "projectId" TEXT,
      "content" TEXT NOT NULL,
      "summary" TEXT NOT NULL,
      "keywords" TEXT DEFAULT '[]',
      "tags" TEXT DEFAULT '[]',
      "importance" REAL DEFAULT 0.5,
      "embedding" TEXT,
      "source" TEXT DEFAULT 'MANUAL',
      "sourceMessageId" TEXT,
      "lastAccessedAt" TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_memories_characterId" ON "memories" ("characterId")`,
      `CREATE INDEX IF NOT EXISTS "idx_memories_chatId" ON "memories" ("chatId")`,
      `CREATE INDEX IF NOT EXISTS "idx_memories_projectId" ON "memories" ("projectId")`,
    ],
  },
  {
    name: 'tags',
    sql: `CREATE TABLE IF NOT EXISTS "tags" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "nameLower" TEXT NOT NULL,
      "quickHide" INTEGER DEFAULT 0,
      "visualStyle" TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL,
      UNIQUE("userId", "nameLower")
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_tags_userId" ON "tags" ("userId")`,
    ],
  },
  {
    name: 'api_keys',
    sql: `CREATE TABLE IF NOT EXISTS "api_keys" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "label" TEXT NOT NULL,
      "provider" TEXT NOT NULL,
      "ciphertext" TEXT NOT NULL,
      "iv" TEXT NOT NULL,
      "authTag" TEXT NOT NULL,
      "isActive" INTEGER DEFAULT 1,
      "lastUsed" TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_api_keys_userId" ON "api_keys" ("userId")`,
      `CREATE INDEX IF NOT EXISTS "idx_api_keys_provider" ON "api_keys" ("provider")`,
    ],
  },
  {
    name: 'connection_profiles',
    sql: `CREATE TABLE IF NOT EXISTS "connection_profiles" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "provider" TEXT NOT NULL,
      "apiKeyId" TEXT,
      "baseUrl" TEXT,
      "modelName" TEXT NOT NULL,
      "parameters" TEXT DEFAULT '{}',
      "isDefault" INTEGER DEFAULT 0,
      "isCheap" INTEGER DEFAULT 0,
      "allowWebSearch" INTEGER DEFAULT 0,
      "useNativeWebSearch" INTEGER DEFAULT 0,
      "tags" TEXT DEFAULT '[]',
      "totalTokens" INTEGER DEFAULT 0,
      "totalPromptTokens" INTEGER DEFAULT 0,
      "totalCompletionTokens" INTEGER DEFAULT 0,
      "messageCount" INTEGER DEFAULT 0,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_connection_profiles_userId" ON "connection_profiles" ("userId")`,
      `CREATE INDEX IF NOT EXISTS "idx_connection_profiles_provider" ON "connection_profiles" ("provider")`,
    ],
  },
  {
    name: 'image_profiles',
    sql: `CREATE TABLE IF NOT EXISTS "image_profiles" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "provider" TEXT NOT NULL,
      "apiKeyId" TEXT,
      "baseUrl" TEXT,
      "modelName" TEXT NOT NULL,
      "parameters" TEXT DEFAULT '{}',
      "isDefault" INTEGER DEFAULT 0,
      "tags" TEXT DEFAULT '[]',
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
      "apiKeyId" TEXT,
      "baseUrl" TEXT,
      "modelName" TEXT NOT NULL,
      "dimensions" INTEGER,
      "isDefault" INTEGER DEFAULT 0,
      "tags" TEXT DEFAULT '[]',
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
      "sha256" TEXT NOT NULL,
      "originalFilename" TEXT NOT NULL,
      "mimeType" TEXT NOT NULL,
      "size" INTEGER NOT NULL,
      "width" INTEGER,
      "height" INTEGER,
      "isPlainText" INTEGER,
      "linkedTo" TEXT DEFAULT '[]',
      "source" TEXT NOT NULL,
      "category" TEXT NOT NULL,
      "generationPrompt" TEXT,
      "generationModel" TEXT,
      "generationRevisedPrompt" TEXT,
      "description" TEXT,
      "tags" TEXT DEFAULT '[]',
      "projectId" TEXT,
      "folderPath" TEXT,
      "mountPointId" TEXT,
      "storageKey" TEXT,
      "s3Key" TEXT,
      "s3Bucket" TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_files_userId" ON "files" ("userId")`,
      `CREATE INDEX IF NOT EXISTS "idx_files_sha256" ON "files" ("sha256")`,
      `CREATE INDEX IF NOT EXISTS "idx_files_projectId" ON "files" ("projectId")`,
      `CREATE INDEX IF NOT EXISTS "idx_files_category" ON "files" ("category")`,
    ],
  },
  {
    name: 'folders',
    sql: `CREATE TABLE IF NOT EXISTS "folders" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "path" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "parentFolderId" TEXT,
      "projectId" TEXT,
      "mountPointId" TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_folders_userId" ON "folders" ("userId")`,
      `CREATE INDEX IF NOT EXISTS "idx_folders_parentFolderId" ON "folders" ("parentFolderId")`,
      `CREATE INDEX IF NOT EXISTS "idx_folders_projectId" ON "folders" ("projectId")`,
    ],
  },
  {
    name: 'roleplay_templates',
    sql: `CREATE TABLE IF NOT EXISTS "roleplay_templates" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT,
      "name" TEXT NOT NULL,
      "description" TEXT,
      "systemPrompt" TEXT NOT NULL,
      "isBuiltIn" INTEGER DEFAULT 0,
      "pluginName" TEXT,
      "tags" TEXT DEFAULT '[]',
      "annotationButtons" TEXT DEFAULT '[]',
      "renderingPatterns" TEXT DEFAULT '[]',
      "dialogueDetection" TEXT,
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
      "userId" TEXT,
      "name" TEXT NOT NULL,
      "content" TEXT NOT NULL,
      "description" TEXT,
      "isBuiltIn" INTEGER DEFAULT 0,
      "category" TEXT,
      "modelHint" TEXT,
      "tags" TEXT DEFAULT '[]',
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
      "avatarDisplayMode" TEXT DEFAULT 'ALWAYS',
      "avatarDisplayStyle" TEXT DEFAULT 'CIRCULAR',
      "tagStyles" TEXT DEFAULT '{}',
      "cheapLLMSettings" TEXT DEFAULT '{}',
      "imageDescriptionProfileId" TEXT,
      "defaultRoleplayTemplateId" TEXT,
      "themePreference" TEXT DEFAULT '{}',
      "sidebarWidth" INTEGER DEFAULT 256,
      "defaultTimestampConfig" TEXT DEFAULT '{}',
      "memoryCascadePreferences" TEXT DEFAULT '{}',
      "tokenDisplaySettings" TEXT DEFAULT '{}',
      "contextCompressionSettings" TEXT DEFAULT '{}',
      "llmLoggingSettings" TEXT DEFAULT '{}',
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
      "userId" TEXT NOT NULL,
      "type" TEXT NOT NULL,
      "status" TEXT DEFAULT 'PENDING',
      "payload" TEXT DEFAULT '{}',
      "priority" INTEGER DEFAULT 0,
      "attempts" INTEGER DEFAULT 0,
      "maxAttempts" INTEGER DEFAULT 3,
      "lastError" TEXT,
      "scheduledAt" TEXT NOT NULL,
      "startedAt" TEXT,
      "completedAt" TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_background_jobs_userId" ON "background_jobs" ("userId")`,
      `CREATE INDEX IF NOT EXISTS "idx_background_jobs_status" ON "background_jobs" ("status")`,
      `CREATE INDEX IF NOT EXISTS "idx_background_jobs_scheduledAt" ON "background_jobs" ("scheduledAt")`,
    ],
  },
  {
    name: 'llm_logs',
    sql: `CREATE TABLE IF NOT EXISTS "llm_logs" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "type" TEXT NOT NULL,
      "messageId" TEXT,
      "chatId" TEXT,
      "characterId" TEXT,
      "provider" TEXT NOT NULL,
      "modelName" TEXT NOT NULL,
      "request" TEXT NOT NULL,
      "response" TEXT NOT NULL,
      "usage" TEXT,
      "cacheUsage" TEXT,
      "durationMs" INTEGER,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_llm_logs_userId" ON "llm_logs" ("userId")`,
      `CREATE INDEX IF NOT EXISTS "idx_llm_logs_chatId" ON "llm_logs" ("chatId")`,
      `CREATE INDEX IF NOT EXISTS "idx_llm_logs_createdAt" ON "llm_logs" ("createdAt" DESC)`,
      `CREATE INDEX IF NOT EXISTS "idx_llm_logs_type" ON "llm_logs" ("type")`,
    ],
  },
  {
    name: 'plugin_configs',
    sql: `CREATE TABLE IF NOT EXISTS "plugin_configs" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "pluginName" TEXT NOT NULL,
      "config" TEXT NOT NULL,
      "enabled" INTEGER,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL,
      UNIQUE("userId", "pluginName")
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_plugin_configs_pluginName" ON "plugin_configs" ("pluginName")`,
      `CREATE INDEX IF NOT EXISTS "idx_plugin_configs_userId" ON "plugin_configs" ("userId")`,
    ],
  },
  // Provider models (global cache of available models)
  {
    name: 'provider_models',
    sql: `CREATE TABLE IF NOT EXISTS "provider_models" (
      "id" TEXT PRIMARY KEY,
      "provider" TEXT NOT NULL,
      "modelId" TEXT NOT NULL,
      "modelType" TEXT DEFAULT 'chat',
      "displayName" TEXT NOT NULL,
      "baseUrl" TEXT,
      "contextWindow" INTEGER,
      "maxOutputTokens" INTEGER,
      "deprecated" INTEGER DEFAULT 0,
      "experimental" INTEGER DEFAULT 0,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_provider_models_provider" ON "provider_models" ("provider")`,
      `CREATE INDEX IF NOT EXISTS "idx_provider_models_modelType" ON "provider_models" ("modelType")`,
    ],
  },
  // Projects
  {
    name: 'projects',
    sql: `CREATE TABLE IF NOT EXISTS "projects" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "description" TEXT,
      "instructions" TEXT,
      "allowAnyCharacter" INTEGER DEFAULT 0,
      "characterRoster" TEXT DEFAULT '[]',
      "color" TEXT,
      "icon" TEXT,
      "mountPointId" TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_projects_userId" ON "projects" ("userId")`,
    ],
  },
  // Mount points (storage backends)
  {
    name: 'mount_points',
    sql: `CREATE TABLE IF NOT EXISTS "mount_points" (
      "id" TEXT PRIMARY KEY,
      "name" TEXT NOT NULL,
      "description" TEXT,
      "backendType" TEXT NOT NULL,
      "backendConfig" TEXT NOT NULL,
      "encryptedSecrets" TEXT,
      "scope" TEXT NOT NULL,
      "userId" TEXT,
      "isDefault" INTEGER DEFAULT 0,
      "enabled" INTEGER DEFAULT 1,
      "healthStatus" TEXT DEFAULT 'unknown',
      "lastHealthCheck" TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_mount_points_userId" ON "mount_points" ("userId")`,
      `CREATE INDEX IF NOT EXISTS "idx_mount_points_scope" ON "mount_points" ("scope")`,
    ],
  },
  // File permissions (LLM write permissions)
  {
    name: 'file_permissions',
    sql: `CREATE TABLE IF NOT EXISTS "file_permissions" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "scope" TEXT NOT NULL,
      "fileId" TEXT,
      "projectId" TEXT,
      "grantedAt" TEXT NOT NULL,
      "grantedInChatId" TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_file_permissions_userId" ON "file_permissions" ("userId")`,
      `CREATE INDEX IF NOT EXISTS "idx_file_permissions_scope" ON "file_permissions" ("scope")`,
    ],
  },
  // Vector indices (embeddings for semantic search)
  {
    name: 'vector_indices',
    sql: `CREATE TABLE IF NOT EXISTS "vector_indices" (
      "id" TEXT PRIMARY KEY,
      "characterId" TEXT NOT NULL,
      "version" INTEGER NOT NULL,
      "dimensions" INTEGER NOT NULL,
      "entries" TEXT DEFAULT '[]',
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_vector_indices_characterId" ON "vector_indices" ("characterId")`,
    ],
  },
  // Sync instances (remote Quilltap instances)
  {
    name: 'sync_instances',
    sql: `CREATE TABLE IF NOT EXISTS "sync_instances" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "url" TEXT NOT NULL,
      "apiKey" TEXT NOT NULL,
      "remoteUserId" TEXT,
      "isActive" INTEGER DEFAULT 1,
      "lastSyncAt" TEXT,
      "lastSyncStatus" TEXT,
      "schemaVersion" TEXT,
      "appVersion" TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_sync_instances_userId" ON "sync_instances" ("userId")`,
    ],
  },
  // Sync mappings (local to remote ID mappings)
  {
    name: 'sync_mappings',
    sql: `CREATE TABLE IF NOT EXISTS "sync_mappings" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "instanceId" TEXT NOT NULL,
      "entityType" TEXT NOT NULL,
      "localId" TEXT NOT NULL,
      "remoteId" TEXT NOT NULL,
      "lastSyncedAt" TEXT NOT NULL,
      "lastLocalUpdatedAt" TEXT NOT NULL,
      "lastRemoteUpdatedAt" TEXT NOT NULL,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_sync_mappings_userId" ON "sync_mappings" ("userId")`,
      `CREATE INDEX IF NOT EXISTS "idx_sync_mappings_instanceId" ON "sync_mappings" ("instanceId")`,
      `CREATE INDEX IF NOT EXISTS "idx_sync_mappings_localId" ON "sync_mappings" ("localId")`,
    ],
  },
  // Sync operations (audit log)
  {
    name: 'sync_operations',
    sql: `CREATE TABLE IF NOT EXISTS "sync_operations" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "instanceId" TEXT NOT NULL,
      "direction" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "progress" TEXT,
      "entityCounts" TEXT DEFAULT '{}',
      "conflicts" TEXT DEFAULT '[]',
      "errors" TEXT DEFAULT '[]',
      "startedAt" TEXT NOT NULL,
      "completedAt" TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_sync_operations_userId" ON "sync_operations" ("userId")`,
      `CREATE INDEX IF NOT EXISTS "idx_sync_operations_instanceId" ON "sync_operations" ("instanceId")`,
    ],
  },
  // User sync API keys
  {
    name: 'user_sync_api_keys',
    sql: `CREATE TABLE IF NOT EXISTS "user_sync_api_keys" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "keyPrefix" TEXT NOT NULL,
      "keyHash" TEXT NOT NULL,
      "isActive" INTEGER DEFAULT 1,
      "lastUsedAt" TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "idx_user_sync_api_keys_userId" ON "user_sync_api_keys" ("userId")`,
      `CREATE INDEX IF NOT EXISTS "idx_user_sync_api_keys_keyPrefix" ON "user_sync_api_keys" ("keyPrefix")`,
    ],
  },
  // Migrations state (tracks which migrations have been run)
  {
    name: 'migrations_state',
    sql: `CREATE TABLE IF NOT EXISTS "migrations_state" (
      "id" TEXT PRIMARY KEY,
      "completedAt" TEXT NOT NULL,
      "quilltapVersion" TEXT NOT NULL,
      "itemsAffected" INTEGER NOT NULL DEFAULT 0,
      "message" TEXT
    )`,
    indexes: [],
  },
  // Migrations metadata (for lastChecked, etc.)
  {
    name: 'migrations_metadata',
    sql: `CREATE TABLE IF NOT EXISTS "migrations_metadata" (
      "key" TEXT PRIMARY KEY,
      "value" TEXT NOT NULL
    )`,
    indexes: [],
  },
];

export const sqliteInitialSchemaMigration: Migration = {
  id: 'sqlite-initial-schema-v1',
  description: 'Create initial SQLite database schema',
  introducedInVersion: '2.8.0',

  async shouldRun(): Promise<boolean> {
    // Only run for SQLite backend
    if (!isSQLiteBackend()) {
      return false;
    }

    // Check if any tables are missing
    for (const table of SQLITE_TABLES) {
      if (!sqliteTableExists(table.name)) {
        return true;
      }
    }
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
        for (const table of SQLITE_TABLES) {
          if (!sqliteTableExists(table.name)) {
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

/**
 * Ensure all SQLite tables exist on a specific database instance.
 * This is used by the migration service to create tables before migrating data
 * from MongoDB to SQLite, since the normal schema migration only runs when
 * SQLite is the active backend.
 *
 * @param db The better-sqlite3 database instance
 * @returns Object with count of tables and indexes created
 */
export function ensureSQLiteTablesExist(db: import('better-sqlite3').Database): {
  tablesCreated: number;
  indexesCreated: number;
} {
  let tablesCreated = 0;
  let indexesCreated = 0;

  logger.info('Ensuring SQLite tables exist for migration', {
    context: 'database.migration.ensureSQLiteTablesExist',
    tableCount: SQLITE_TABLES.length,
  });

  // Run all table creation and index creation in a transaction
  const createSchema = db.transaction(() => {
    for (const table of SQLITE_TABLES) {
      // Check if table exists using pragma
      const tableInfo = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table.name);

      if (!tableInfo) {
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

  logger.info('SQLite tables ensured for migration', {
    context: 'database.migration.ensureSQLiteTablesExist',
    tablesCreated,
    indexesCreated,
  });

  return { tablesCreated, indexesCreated };
}
