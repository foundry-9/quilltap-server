/**
 * Migration Registry
 *
 * All migrations should be imported and exported here.
 * They are executed in dependency order as defined in each migration.
 *
 * This file was migrated from the qtap-plugin-upgrade plugin to run
 * during server startup before any requests are served.
 *
 * Only migrations introduced in version 2.7.0+ are included.
 * Legacy migrations from earlier versions have been removed since they
 * are only needed for upgrading from pre-2.7.0 installations.
 */

import type { Migration } from '../types';
// Web search decoupling
import { addUseNativeWebSearchFieldMigration } from './add-use-native-web-search-field';
// Mount points migration
import { createMountPointsMigration } from './create-mount-points';
// Fix missing storage keys
import { fixMissingStorageKeysMigration } from './fix-missing-storage-keys';
// Fix orphan PERSONA participants
import { fixOrphanPersonaParticipantsMigration } from './fix-orphan-persona-participants';
// Cleanup orphan file records
import { cleanupOrphanFileRecordsMigration } from './cleanup-orphan-file-records';
// LLM logs collection
import { addLLMLogsCollectionMigration } from './add-llm-logs-collection';
// SQLite initial schema
import { sqliteInitialSchemaMigration } from './sqlite-initial-schema';
// Centralized data directory migration
import { migrateToCentralizedDataDirMigration } from './migrate-to-centralized-data-dir';
// Per-project mount points
import { perProjectMountPointsMigration } from './per-project-mount-points';
// Folder entities migration
import { createFolderEntitiesMigration } from './create-folder-entities';
// Remove auth tables (single-user mode)
import { removeAuthTablesMigration } from './remove-auth-tables';
// Re-encrypt API keys after single-user migration
import { reencryptApiKeysMigration } from './reencrypt-api-keys';
// Add defaultImageProfileId to characters
import { addDefaultImageProfileFieldMigration } from './add-default-image-profile-field';
// Migrate user plugins to site plugins (single-user mode)
import { migrateUserPluginsToSiteMigration } from './migrate-user-plugins-to-site';
// Migrate site plugins to data directory
import { migrateSitePluginsToDataDirMigration } from './migrate-site-plugins-to-data-dir';
// Drop sync tables (sync functionality removed)
import { dropSyncTablesMigration } from './drop-sync-tables';
// Add tool settings fields to chats
import { addChatToolSettingsFieldsMigration } from './add-chat-tool-settings-fields';
// Add default tool settings fields to projects
import { addProjectToolSettingsFieldsMigration } from './add-project-tool-settings-fields';
// Create embedding tables for built-in TF-IDF provider
import { createEmbeddingTablesMigration } from './create-embedding-tables';
// Add state fields to chats and projects
import { addStateFieldsMigration } from './add-state-fields';
// Add autoDetectRng field to chat_settings
import { addAutoDetectRngFieldMigration } from './add-auto-detect-rng-field';
// Add compressionCache field to chats
import { addCompressionCacheFieldMigration } from './add-compression-cache-field';
// Add agent mode fields to chat_settings, characters, projects, and chats
import { addAgentModeFieldsMigration } from './add-agent-mode-fields';
// Add story backgrounds fields to chat_settings, chats, and projects
import { addStoryBackgroundsFieldsMigration } from './add-story-backgrounds-fields';
// Add imageProfileId field to chats (move from per-participant to per-chat)
import { addChatImageProfileFieldMigration } from './add-chat-image-profile-field';
// Add dangerous content handling fields
import { addDangerousContentFieldsMigration } from './add-dangerous-content-fields';
// Add chat-level danger classification fields
import { addChatDangerClassificationFieldsMigration } from './add-chat-danger-classification-fields';
// Fix chat updatedAt timestamps polluted by background jobs
import { fixChatUpdatedAtTimestampsMigration } from './fix-chat-updated-at-timestamps';
// Add aliases field to characters
import { addCharacterAliasesFieldMigration } from './add-character-aliases-field';
// Add pronouns field to characters
import { addCharacterPronounsFieldMigration } from './add-character-pronouns-field';
// Add clothingRecords field to characters
import { addCharacterClothingRecordsFieldMigration } from './add-character-clothing-records-field';
// Fix chat messageCount to only count visible message bubbles
import { fixChatMessageCountsMigration } from './fix-chat-message-counts';
// Add memory gate fields (reinforcement tracking, related links)
import { addMemoryGateFieldsMigration } from './add-memory-gate-fields';
// Migrate legacy JSONL file entries to SQLite
import { migrateLegacyJsonlFilesMigration } from './migrate-legacy-jsonl-files';
// Add missing columns to chat_messages and fix empty JSON strings
import { addChatMessageMissingColumnsMigration } from './add-chat-message-missing-columns';
// Normalize vector embedding storage to Float32 BLOBs
import { normalizeVectorStorageMigration } from './normalize-vector-storage';
// Add allowToolUse field to connection profiles
import { addProfileAllowToolUseFieldMigration } from './add-profile-allow-tool-use-field';
// Drop mount points system (S3 + mount point abstraction removed)
import { dropMountPointsMigration } from './drop-mount-points';

/**
 * All available migrations.
 * Order here doesn't matter - migrations will be sorted by dependencies.
 *
 * Only includes migrations from v2.7.0 and later.
 */
export const migrations: Migration[] = [
  // Web search decoupling
  addUseNativeWebSearchFieldMigration,
  // Mount points migration
  createMountPointsMigration,
  // Fix missing storage keys
  fixMissingStorageKeysMigration,
  // Fix orphan PERSONA participants
  fixOrphanPersonaParticipantsMigration,
  // Cleanup orphan file records
  cleanupOrphanFileRecordsMigration,
  // LLM logs collection
  addLLMLogsCollectionMigration,
  // SQLite initial schema (only runs on SQLite backend)
  sqliteInitialSchemaMigration,
  // Centralized data directory migration
  migrateToCentralizedDataDirMigration,
  // Per-project mount points
  perProjectMountPointsMigration,
  // Folder entities migration
  createFolderEntitiesMigration,
  // Remove auth tables (single-user mode)
  removeAuthTablesMigration,
  // Re-encrypt API keys after single-user migration
  reencryptApiKeysMigration,
  // Add defaultImageProfileId to characters
  addDefaultImageProfileFieldMigration,
  // Migrate user plugins to site plugins (single-user mode)
  migrateUserPluginsToSiteMigration,
  // Migrate site plugins to data directory
  migrateSitePluginsToDataDirMigration,
  // Drop sync tables (sync functionality removed)
  dropSyncTablesMigration,
  // Add tool settings fields to chats
  addChatToolSettingsFieldsMigration,
  // Add default tool settings fields to projects
  addProjectToolSettingsFieldsMigration,
  // Create embedding tables for built-in TF-IDF provider
  createEmbeddingTablesMigration,
  // Add state fields to chats and projects
  addStateFieldsMigration,
  // Add autoDetectRng field to chat_settings
  addAutoDetectRngFieldMigration,
  // Add compressionCache field to chats
  addCompressionCacheFieldMigration,
  // Add agent mode fields
  addAgentModeFieldsMigration,
  // Add story backgrounds fields
  addStoryBackgroundsFieldsMigration,
  // Add imageProfileId field to chats (per-chat instead of per-participant)
  addChatImageProfileFieldMigration,
  // Add dangerous content handling fields
  addDangerousContentFieldsMigration,
  // Add chat-level danger classification fields
  addChatDangerClassificationFieldsMigration,
  // Fix chat updatedAt timestamps polluted by background jobs
  fixChatUpdatedAtTimestampsMigration,
  // Add aliases field to characters
  addCharacterAliasesFieldMigration,
  // Add pronouns field to characters
  addCharacterPronounsFieldMigration,
  // Add clothingRecords field to characters
  addCharacterClothingRecordsFieldMigration,
  // Fix chat messageCount to only count visible message bubbles
  fixChatMessageCountsMigration,
  // Add memory gate fields (reinforcement tracking, related links)
  addMemoryGateFieldsMigration,
  // Migrate legacy JSONL file entries to SQLite
  migrateLegacyJsonlFilesMigration,
  // Add missing columns to chat_messages and fix empty JSON strings
  addChatMessageMissingColumnsMigration,
  // Normalize vector embedding storage to Float32 BLOBs
  normalizeVectorStorageMigration,
  // Add allowToolUse field to connection profiles
  addProfileAllowToolUseFieldMigration,
  // Drop mount points system (S3 + mount point abstraction removed)
  dropMountPointsMigration,
];

export {
  // Web search decoupling
  addUseNativeWebSearchFieldMigration,
  // Mount points migration
  createMountPointsMigration,
  // Fix missing storage keys
  fixMissingStorageKeysMigration,
  // Fix orphan PERSONA participants
  fixOrphanPersonaParticipantsMigration,
  // Cleanup orphan file records
  cleanupOrphanFileRecordsMigration,
  // LLM logs collection
  addLLMLogsCollectionMigration,
  // SQLite initial schema
  sqliteInitialSchemaMigration,
  // Centralized data directory migration
  migrateToCentralizedDataDirMigration,
  // Per-project mount points
  perProjectMountPointsMigration,
  // Folder entities migration
  createFolderEntitiesMigration,
  // Remove auth tables (single-user mode)
  removeAuthTablesMigration,
  // Re-encrypt API keys after single-user migration
  reencryptApiKeysMigration,
  // Add defaultImageProfileId to characters
  addDefaultImageProfileFieldMigration,
  // Migrate user plugins to site plugins (single-user mode)
  migrateUserPluginsToSiteMigration,
  // Migrate site plugins to data directory
  migrateSitePluginsToDataDirMigration,
  // Drop sync tables (sync functionality removed)
  dropSyncTablesMigration,
  // Add tool settings fields to chats
  addChatToolSettingsFieldsMigration,
  // Add default tool settings fields to projects
  addProjectToolSettingsFieldsMigration,
  // Create embedding tables for built-in TF-IDF provider
  createEmbeddingTablesMigration,
  // Add state fields to chats and projects
  addStateFieldsMigration,
  // Add autoDetectRng field to chat_settings
  addAutoDetectRngFieldMigration,
  // Add compressionCache field to chats
  addCompressionCacheFieldMigration,
  // Add agent mode fields
  addAgentModeFieldsMigration,
  // Add story backgrounds fields
  addStoryBackgroundsFieldsMigration,
  // Add imageProfileId field to chats (per-chat instead of per-participant)
  addChatImageProfileFieldMigration,
  // Add dangerous content handling fields
  addDangerousContentFieldsMigration,
  // Add chat-level danger classification fields
  addChatDangerClassificationFieldsMigration,
  // Fix chat updatedAt timestamps polluted by background jobs
  fixChatUpdatedAtTimestampsMigration,
  // Add aliases field to characters
  addCharacterAliasesFieldMigration,
  // Add pronouns field to characters
  addCharacterPronounsFieldMigration,
  // Add clothingRecords field to characters
  addCharacterClothingRecordsFieldMigration,
  // Fix chat messageCount to only count visible message bubbles
  fixChatMessageCountsMigration,
  // Add memory gate fields (reinforcement tracking, related links)
  addMemoryGateFieldsMigration,
  // Migrate legacy JSONL file entries to SQLite
  migrateLegacyJsonlFilesMigration,
  // Add missing columns to chat_messages and fix empty JSON strings
  addChatMessageMissingColumnsMigration,
  // Normalize vector embedding storage to Float32 BLOBs
  normalizeVectorStorageMigration,
  // Add allowToolUse field to connection profiles
  addProfileAllowToolUseFieldMigration,
  // Drop mount points system (S3 + mount point abstraction removed)
  dropMountPointsMigration,
};
