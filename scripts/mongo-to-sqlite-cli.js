#!/usr/bin/env node

/**
 * MongoDB to SQLite Migration CLI Tool
 *
 * A standalone utility to migrate data from a MongoDB database to SQLite.
 * This tool is designed to work independently of the Quilltap application.
 *
 * Usage:
 *   node mongo-to-sqlite-cli.js --mongo-uri <uri> --output <sqlite-path>
 *
 * Options:
 *   --mongo-uri, -m    MongoDB connection URI (required)
 *   --output, -o       Output SQLite database path (required)
 *   --db-name, -d      MongoDB database name (default: quilltap)
 *   --dry-run          Check connectivity without migrating
 *   --verbose, -v      Enable verbose logging
 *   --help, -h         Show this help message
 *
 * Example:
 *   node mongo-to-sqlite-cli.js -m "mongodb://localhost:27017" -o ./quilltap.db
 */

const { MongoClient } = require('mongodb');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// ============================================================================
// SQLite Schema Definitions (hardcoded from Quilltap schema)
// ============================================================================

const SQLITE_TABLES = [
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
  {
    name: 'migrations_metadata',
    sql: `CREATE TABLE IF NOT EXISTS "migrations_metadata" (
      "key" TEXT PRIMARY KEY,
      "value" TEXT NOT NULL
    )`,
    indexes: [],
  },
];

// Collections to migrate, ordered by dependency priority
const MIGRATION_COLLECTIONS = [
  // Priority 1: No dependencies
  { name: 'users', tableName: 'users', priority: 1 },
  { name: 'tags', tableName: 'tags', priority: 1 },
  { name: 'provider_models', tableName: 'provider_models', priority: 1 },

  // Priority 2: Depend on users
  { name: 'accounts', tableName: 'accounts', priority: 2 },
  { name: 'sessions', tableName: 'sessions', priority: 2 },
  { name: 'api_keys', tableName: 'api_keys', priority: 2 },
  { name: 'connection_profiles', tableName: 'connection_profiles', priority: 2 },
  { name: 'image_profiles', tableName: 'image_profiles', priority: 2 },
  { name: 'embedding_profiles', tableName: 'embedding_profiles', priority: 2 },
  { name: 'chat_settings', tableName: 'chat_settings', priority: 2 },
  { name: 'projects', tableName: 'projects', priority: 2 },
  { name: 'folders', tableName: 'folders', priority: 2 },

  // Priority 3: Depend on folders
  { name: 'files', tableName: 'files', priority: 3 },
  { name: 'mount_points', tableName: 'mount_points', priority: 3 },
  { name: 'file_permissions', tableName: 'file_permissions', priority: 3 },

  // Priority 4: Depend on users, characters
  { name: 'characters', tableName: 'characters', priority: 4 },
  { name: 'prompt_templates', tableName: 'prompt_templates', priority: 4 },
  { name: 'roleplay_templates', tableName: 'roleplay_templates', priority: 4 },
  { name: 'plugin_configs', tableName: 'plugin_configs', priority: 4 },

  // Priority 5: Depend on characters
  { name: 'chats', tableName: 'chats', priority: 5 },
  { name: 'memories', tableName: 'memories', priority: 5 },

  // Priority 6: Depend on chats
  { name: 'chat_messages', tableName: 'chat_messages', priority: 6 },

  // Priority 7: Misc
  { name: 'vector_indices', tableName: 'vector_indices', priority: 7 },
  { name: 'background_jobs', tableName: 'background_jobs', priority: 7 },
  { name: 'llm_logs', tableName: 'llm_logs', priority: 7 },

  // Priority 8: Sync tables
  { name: 'sync_instances', tableName: 'sync_instances', priority: 8 },
  { name: 'sync_mappings', tableName: 'sync_mappings', priority: 8 },
  { name: 'sync_operations', tableName: 'sync_operations', priority: 8 },
  { name: 'user_sync_api_keys', tableName: 'user_sync_api_keys', priority: 8 },

  // Priority 9: Migrations state
  { name: 'migrations_state', tableName: 'migrations_state', priority: 9 },
];

// JSON columns that need serialization
const JSON_COLUMNS = {
  users: ['trustedDevices', 'totp', 'backupCodes', 'totpAttempts'],
  characters: ['systemPrompts', 'personaLinks', 'tags', 'avatarOverrides', 'physicalDescriptions'],
  chats: ['participants', 'tags', 'timestampConfig', 'impersonatingParticipantIds'],
  chat_messages: ['attachments'],
  memories: ['keywords', 'tags'],
  connection_profiles: ['parameters', 'tags'],
  image_profiles: ['parameters', 'tags'],
  embedding_profiles: ['tags'],
  files: ['linkedTo', 'tags'],
  tags: ['visualStyle'],
  roleplay_templates: ['tags', 'annotationButtons', 'renderingPatterns'],
  prompt_templates: ['tags'],
  chat_settings: ['tagStyles', 'cheapLLMSettings', 'themePreference', 'defaultTimestampConfig', 'memoryCascadePreferences', 'tokenDisplaySettings', 'contextCompressionSettings', 'llmLoggingSettings'],
  background_jobs: ['payload'],
  projects: ['characterRoster'],
  sync_operations: ['entityCounts', 'conflicts', 'errors'],
  vector_indices: ['entries'],
};

// Boolean columns that need integer conversion
const BOOLEAN_COLUMNS = {
  characters: ['isFavorite', 'npc'],
  chats: ['isPaused', 'isManuallyRenamed', 'documentEditingMode', 'requestFullContextOnNextMessage'],
  tags: ['quickHide'],
  api_keys: ['isActive'],
  connection_profiles: ['isDefault', 'isCheap', 'allowWebSearch', 'useNativeWebSearch'],
  image_profiles: ['isDefault'],
  embedding_profiles: ['isDefault'],
  files: ['isPlainText'],
  roleplay_templates: ['isBuiltIn'],
  prompt_templates: ['isBuiltIn'],
  plugin_configs: ['enabled'],
  provider_models: ['deprecated', 'experimental'],
  projects: ['allowAnyCharacter'],
  mount_points: ['isDefault', 'enabled'],
  sync_instances: ['isActive'],
  user_sync_api_keys: ['isActive'],
};

// ============================================================================
// Argument Parsing
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    mongoUri: null,
    output: null,
    dbName: 'quilltap',
    dryRun: false,
    verbose: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--mongo-uri':
      case '-m':
        options.mongoUri = args[++i];
        break;
      case '--output':
      case '-o':
        options.output = args[++i];
        break;
      case '--db-name':
      case '-d':
        options.dbName = args[++i];
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        process.exit(1);
    }
  }

  return options;
}

function showHelp() {
  console.log(`
MongoDB to SQLite Migration CLI Tool

Usage:
  node mongo-to-sqlite-cli.js --mongo-uri <uri> --output <sqlite-path>

Options:
  --mongo-uri, -m    MongoDB connection URI (required)
  --output, -o       Output SQLite database path (required)
  --db-name, -d      MongoDB database name (default: quilltap)
  --dry-run          Check connectivity and count records without migrating
  --verbose, -v      Enable verbose logging
  --help, -h         Show this help message

Example:
  node mongo-to-sqlite-cli.js -m "mongodb://localhost:27017" -o ./quilltap.db
  node mongo-to-sqlite-cli.js -m "mongodb://user:pass@host:27017" -d mydb -o /path/to/output.db
`);
}

// ============================================================================
// Logging
// ============================================================================

let verbose = false;

function log(message, data = null) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] ${message}`, data);
  } else {
    console.log(`[${timestamp}] ${message}`);
  }
}

function logVerbose(message, data = null) {
  if (verbose) {
    log(message, data);
  }
}

function logError(message, error = null) {
  const timestamp = new Date().toISOString();
  if (error) {
    console.error(`[${timestamp}] ERROR: ${message}`, error);
  } else {
    console.error(`[${timestamp}] ERROR: ${message}`);
  }
}

// ============================================================================
// Schema Creation
// ============================================================================

function createSQLiteSchema(db) {
  log('Creating SQLite schema...');
  let tablesCreated = 0;
  let indexesCreated = 0;

  const createSchema = db.transaction(() => {
    for (const table of SQLITE_TABLES) {
      // Check if table exists
      const tableInfo = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table.name);

      if (!tableInfo) {
        logVerbose(`Creating table: ${table.name}`);
        db.exec(table.sql);
        tablesCreated++;

        // Create indexes for this table
        for (const indexSql of table.indexes) {
          db.exec(indexSql);
          indexesCreated++;
        }
      } else {
        logVerbose(`Table already exists: ${table.name}`);
      }
    }
  });

  createSchema();
  log(`Schema created: ${tablesCreated} tables, ${indexesCreated} indexes`);
  return { tablesCreated, indexesCreated };
}

// ============================================================================
// Data Transformation
// ============================================================================

// Tables that don't have updatedAt column
const TABLES_WITHOUT_UPDATED_AT = ['chat_messages', 'migrations_state', 'migrations_metadata'];

function transformDocument(collectionName, doc) {
  const transformed = { ...doc };

  // Remove MongoDB _id (we use 'id' field)
  delete transformed._id;

  // Handle timestamps based on table schema
  const hasUpdatedAt = !TABLES_WITHOUT_UPDATED_AT.includes(collectionName);

  if (hasUpdatedAt) {
    // Ensure updatedAt is set (default to createdAt if missing)
    if (!transformed.updatedAt && transformed.createdAt) {
      transformed.updatedAt = transformed.createdAt;
    }
    if (!transformed.updatedAt) {
      transformed.updatedAt = new Date().toISOString();
    }
  } else {
    // Remove updatedAt if it exists but table doesn't support it
    delete transformed.updatedAt;
  }

  if (!transformed.createdAt) {
    transformed.createdAt = transformed.updatedAt || new Date().toISOString();
  }

  // Convert boolean columns to integers first (before JSON serialization)
  const boolCols = BOOLEAN_COLUMNS[collectionName] || [];
  for (const col of boolCols) {
    if (transformed[col] !== undefined) {
      transformed[col] = transformed[col] ? 1 : 0;
    }
  }

  // Serialize any remaining object/array values that aren't already strings
  // This is a catch-all to handle any fields we may have missed in JSON_COLUMNS
  for (const key of Object.keys(transformed)) {
    const value = transformed[key];
    if (value !== null && value !== undefined) {
      const valueType = typeof value;
      if (valueType === 'object') {
        // Check if it's a Date object
        if (value instanceof Date) {
          transformed[key] = value.toISOString();
        } else {
          // Serialize objects and arrays to JSON
          transformed[key] = JSON.stringify(value);
        }
      }
    }
  }

  return transformed;
}

// ============================================================================
// SQLite Insert Helper
// ============================================================================

function buildInsertStatement(db, tableName, doc) {
  const keys = Object.keys(doc).filter(k => doc[k] !== undefined);
  const placeholders = keys.map(() => '?').join(', ');
  const columns = keys.map(k => `"${k}"`).join(', ');
  const values = keys.map(k => doc[k]);

  const sql = `INSERT OR IGNORE INTO "${tableName}" (${columns}) VALUES (${placeholders})`;
  return { sql, values };
}

function insertDocument(db, tableName, doc) {
  const { sql, values } = buildInsertStatement(db, tableName, doc);
  try {
    const stmt = db.prepare(sql);
    const result = stmt.run(...values);
    return result.changes > 0;
  } catch (error) {
    logError(`Failed to insert into ${tableName}:`, error.message);
    logVerbose('Document:', JSON.stringify(doc, null, 2));
    throw error;
  }
}

// ============================================================================
// Collection Migration
// ============================================================================

async function migrateCollection(mongoDb, sqliteDb, collectionInfo) {
  const { name, tableName } = collectionInfo;

  // Special handling for chat_messages
  if (name === 'chat_messages') {
    return migrateChatMessages(mongoDb, sqliteDb);
  }

  // Special handling for migrations_state
  if (name === 'migrations_state') {
    return migrateMigrationsState(mongoDb, sqliteDb);
  }

  const collection = mongoDb.collection(name);
  const cursor = collection.find({});
  const documents = await cursor.toArray();

  if (documents.length === 0) {
    logVerbose(`Collection ${name} is empty, skipping`);
    return 0;
  }

  log(`Migrating ${documents.length} documents from ${name}...`);

  let migratedCount = 0;
  const BATCH_SIZE = 100;

  for (let i = 0; i < documents.length; i += BATCH_SIZE) {
    const batch = documents.slice(i, i + BATCH_SIZE);

    const insertBatch = sqliteDb.transaction(() => {
      for (const doc of batch) {
        const transformed = transformDocument(name, doc);
        if (insertDocument(sqliteDb, tableName, transformed)) {
          migratedCount++;
        }
      }
    });

    insertBatch();

    if (verbose && i + BATCH_SIZE < documents.length) {
      logVerbose(`  Progress: ${Math.min(i + BATCH_SIZE, documents.length)}/${documents.length}`);
    }
  }

  log(`  Migrated ${migratedCount} documents from ${name}`);
  return migratedCount;
}

async function migrateChatMessages(mongoDb, sqliteDb) {
  log('Migrating chat_messages with normalization (embedded array -> rows)...');

  const collection = mongoDb.collection('chat_messages');
  const cursor = collection.find({});
  const chatDocs = await cursor.toArray();

  if (chatDocs.length === 0) {
    logVerbose('No chat_messages documents found');
    return 0;
  }

  let migratedCount = 0;

  for (const chatDoc of chatDocs) {
    const chatId = chatDoc.chatId;
    const messages = chatDoc.messages || [];

    if (messages.length === 0) continue;

    logVerbose(`  Processing ${messages.length} messages for chat ${chatId}`);

    const insertBatch = sqliteDb.transaction(() => {
      for (const message of messages) {
        // Create normalized message row with chatId
        const normalizedMessage = {
          ...message,
          chatId,
        };

        const transformed = transformDocument('chat_messages', normalizedMessage);

        if (insertDocument(sqliteDb, 'chat_messages', transformed)) {
          migratedCount++;
        }
      }
    });

    insertBatch();
  }

  log(`  Migrated ${migratedCount} messages from ${chatDocs.length} chat documents`);
  return migratedCount;
}

async function migrateMigrationsState(mongoDb, sqliteDb) {
  log('Migrating migrations_state with normalization (single doc -> rows)...');

  const collection = mongoDb.collection('migrations_state');
  const cursor = collection.find({});
  const docs = await cursor.toArray();

  if (docs.length === 0) {
    logVerbose('No migrations_state documents found');
    return 0;
  }

  // Find the state document
  const stateDoc = docs.find(d => d._id === 'migration_state');
  if (!stateDoc || !stateDoc.completedMigrations) {
    logVerbose('No migration_state document with completedMigrations found');
    return 0;
  }

  let migratedCount = 0;

  const insertBatch = sqliteDb.transaction(() => {
    // Migrate each completed migration as a row
    for (const migration of stateDoc.completedMigrations) {
      const row = {
        id: migration.id,
        completedAt: migration.completedAt,
        quilltapVersion: migration.quilltapVersion || stateDoc.quilltapVersion || 'unknown',
        itemsAffected: migration.itemsAffected || 0,
        message: migration.message || null,
      };

      if (insertDocument(sqliteDb, 'migrations_state', row)) {
        migratedCount++;
      }
    }

    // Save metadata
    if (stateDoc.lastChecked) {
      insertDocument(sqliteDb, 'migrations_metadata', {
        key: 'lastChecked',
        value: stateDoc.lastChecked,
      });
    }

    if (stateDoc.quilltapVersion) {
      insertDocument(sqliteDb, 'migrations_metadata', {
        key: 'quilltapVersion',
        value: stateDoc.quilltapVersion,
      });
    }
  });

  insertBatch();

  log(`  Migrated ${migratedCount} migration records`);
  return migratedCount;
}

// ============================================================================
// Dry Run (Count Records)
// ============================================================================

async function dryRun(mongoDb) {
  log('Dry run - counting records in MongoDB...\n');

  const sortedCollections = [...MIGRATION_COLLECTIONS].sort((a, b) => a.priority - b.priority);
  let totalRecords = 0;
  const counts = {};

  for (const collectionInfo of sortedCollections) {
    const collectionName = collectionInfo.name;

    try {
      const collection = mongoDb.collection(collectionName);
      const exists = await collection.countDocuments({}, { limit: 1 });

      if (collectionName === 'chat_messages') {
        // Count individual messages
        const cursor = collection.find({});
        const chatDocs = await cursor.toArray();
        let messageCount = 0;
        for (const doc of chatDocs) {
          messageCount += (doc.messages || []).length;
        }
        counts[collectionName] = messageCount;
        totalRecords += messageCount;
      } else if (collectionName === 'migrations_state') {
        // Count completedMigrations array items
        const cursor = collection.find({});
        const docs = await cursor.toArray();
        const stateDoc = docs.find(d => d._id === 'migration_state');
        const migrationCount = stateDoc?.completedMigrations?.length || 0;
        counts[collectionName] = migrationCount;
        totalRecords += migrationCount;
      } else if (exists !== undefined) {
        const count = await collection.countDocuments({});
        counts[collectionName] = count;
        totalRecords += count;
      } else {
        counts[collectionName] = 0;
      }
    } catch (error) {
      counts[collectionName] = 0;
      logVerbose(`Collection ${collectionName} does not exist or error: ${error.message}`);
    }
  }

  console.log('\nCollection Record Counts:');
  console.log('='.repeat(50));
  for (const [name, count] of Object.entries(counts)) {
    if (count > 0) {
      console.log(`  ${name.padEnd(30)} ${count.toString().padStart(10)}`);
    }
  }
  console.log('='.repeat(50));
  console.log(`  ${'TOTAL'.padEnd(30)} ${totalRecords.toString().padStart(10)}`);
  console.log('');

  return { counts, totalRecords };
}

// ============================================================================
// Main Migration
// ============================================================================

async function migrate(mongoUri, outputPath, dbName, options = {}) {
  const startTime = Date.now();
  let mongoClient = null;
  let sqliteDb = null;

  try {
    // Connect to MongoDB
    log(`Connecting to MongoDB...`);
    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    const mongoDb = mongoClient.db(dbName);
    log(`Connected to MongoDB database: ${dbName}`);

    // Test connection
    await mongoDb.command({ ping: 1 });
    log('MongoDB connection verified');

    // Dry run mode
    if (options.dryRun) {
      await dryRun(mongoDb);
      return { success: true, dryRun: true };
    }

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
      log(`Created output directory: ${outputDir}`);
    }

    // Open SQLite database
    log(`Opening SQLite database: ${outputPath}`);
    sqliteDb = new Database(outputPath);
    sqliteDb.pragma('foreign_keys = ON');
    sqliteDb.pragma('journal_mode = WAL');

    // Create schema
    createSQLiteSchema(sqliteDb);

    // Get list of existing MongoDB collections
    const collections = await mongoDb.listCollections().toArray();
    const existingCollections = collections.map(c => c.name);
    logVerbose('Existing MongoDB collections:', existingCollections);

    // Sort collections by priority and migrate
    const sortedCollections = [...MIGRATION_COLLECTIONS].sort((a, b) => a.priority - b.priority);

    let totalMigrated = 0;
    let collectionsProcessed = 0;

    for (const collectionInfo of sortedCollections) {
      if (!existingCollections.includes(collectionInfo.name)) {
        logVerbose(`Skipping ${collectionInfo.name} (collection does not exist)`);
        continue;
      }

      try {
        const count = await migrateCollection(mongoDb, sqliteDb, collectionInfo);
        totalMigrated += count;
        collectionsProcessed++;
      } catch (error) {
        logError(`Failed to migrate ${collectionInfo.name}:`, error.message);
        throw error;
      }
    }

    const duration = Date.now() - startTime;
    log(`\nMigration completed successfully!`);
    log(`  Total records migrated: ${totalMigrated}`);
    log(`  Collections processed: ${collectionsProcessed}`);
    log(`  Duration: ${(duration / 1000).toFixed(2)} seconds`);
    log(`  Output: ${outputPath}`);

    return {
      success: true,
      recordsMigrated: totalMigrated,
      collectionsProcessed,
      duration,
      outputPath,
    };

  } catch (error) {
    logError('Migration failed:', error.message);
    if (verbose) {
      console.error(error.stack);
    }
    return { success: false, error: error.message };

  } finally {
    // Cleanup
    if (sqliteDb) {
      sqliteDb.close();
      logVerbose('SQLite database closed');
    }
    if (mongoClient) {
      await mongoClient.close();
      logVerbose('MongoDB connection closed');
    }
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  if (!options.mongoUri) {
    console.error('Error: --mongo-uri is required');
    showHelp();
    process.exit(1);
  }

  if (!options.output && !options.dryRun) {
    console.error('Error: --output is required (unless using --dry-run)');
    showHelp();
    process.exit(1);
  }

  verbose = options.verbose;

  log('MongoDB to SQLite Migration Tool');
  log('================================');
  log(`MongoDB URI: ${options.mongoUri.replace(/\/\/[^:]+:[^@]+@/, '//<credentials>@')}`);
  log(`Database: ${options.dbName}`);
  if (options.output) {
    log(`Output: ${options.output}`);
  }
  if (options.dryRun) {
    log('Mode: DRY RUN');
  }
  log('');

  const result = await migrate(
    options.mongoUri,
    options.output || './quilltap.db',
    options.dbName,
    {
      dryRun: options.dryRun,
      verbose: options.verbose,
    }
  );

  if (result.success) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
