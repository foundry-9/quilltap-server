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
// Drop sync tables (sync functionality removed)
import { dropSyncTablesMigration } from './drop-sync-tables';
// Add tool settings fields to chats
import { addChatToolSettingsFieldsMigration } from './add-chat-tool-settings-fields';

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
  // Drop sync tables (sync functionality removed)
  dropSyncTablesMigration,
  // Add tool settings fields to chats
  addChatToolSettingsFieldsMigration,
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
  // Drop sync tables (sync functionality removed)
  dropSyncTablesMigration,
  // Add tool settings fields to chats
  addChatToolSettingsFieldsMigration,
};
