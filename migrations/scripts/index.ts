/**
 * Migration Registry
 *
 * All migrations should be imported and exported here.
 * They are executed in dependency order as defined in each migration.
 *
 * This file was migrated from the qtap-plugin-upgrade plugin to run
 * during server startup before any requests are served.
 */

import type { Migration } from '../types';
import { convertOpenRouterProfilesMigration } from './convert-openrouter-profiles';
import { enableProviderPluginsMigration } from './enable-provider-plugins';
// Phase 3: MongoDB + S3 Migration System
import { validateMongoDBConfigMigration } from './validate-mongodb-config';
import { validateS3ConfigMigration } from './validate-s3-config';
import { migrateJsonToMongoDBMigration } from './migrate-json-to-mongodb';
import { migrateFilesToS3Migration } from './migrate-files-to-s3';
// Data integrity migrations
import { ensureUserUsernamesMigration } from './ensure-user-usernames';
import { inheritFileTagsMigration } from './inherit-file-tags';
import { migrateCharacterSystemPromptsMigration } from './migrate-character-system-prompts';
import { migrateTagStylesToTagsMigration } from './migrate-tag-styles-to-tags';
// Plugin system migrations
import { removeQuilltapRPBuiltinMigration } from './remove-quilltap-rp-builtin';
// Personas-to-characters migration
import { migratePersonasToCharactersMigration } from './migrate-personas-to-characters';
// Multi-character chat migrations
import { addMultiCharacterFieldsMigration } from './add-multi-character-fields';
import { addInterCharacterMemoryFieldsMigration } from './add-inter-character-memory-fields';
// Token usage tracking
import { addTokenTrackingFieldsMigration } from './add-token-tracking-fields';
// Web search decoupling
import { addUseNativeWebSearchFieldMigration } from './add-use-native-web-search-field';
// S3 key restructuring
import { restructureS3KeysMigration } from './restructure-s3-keys';
// Memory aboutCharacterId population
import { populateMemoryAboutCharacterIdsMigration } from './populate-memory-about-character-ids';
// Mount points migration
import { createMountPointsMigration } from './create-mount-points';
// Per-project mount points
import { perProjectMountPointsMigration } from './per-project-mount-points';
// Folder entities migration
import { createFolderEntitiesMigration } from './create-folder-entities';
// Fix orphan PERSONA participants
import { fixOrphanPersonaParticipantsMigration } from './fix-orphan-persona-participants';
// Fix missing storage keys
import { fixMissingStorageKeysMigration } from './fix-missing-storage-keys';
// Cleanup orphan file records
import { cleanupOrphanFileRecordsMigration } from './cleanup-orphan-file-records';

/**
 * All available migrations.
 * Order here doesn't matter - migrations will be sorted by dependencies.
 */
export const migrations: Migration[] = [
  convertOpenRouterProfilesMigration,
  enableProviderPluginsMigration,
  // Phase 3: MongoDB + S3 Migration System
  validateMongoDBConfigMigration,
  validateS3ConfigMigration,
  migrateJsonToMongoDBMigration,
  migrateFilesToS3Migration,
  // Data integrity migrations
  ensureUserUsernamesMigration,
  inheritFileTagsMigration,
  migrateCharacterSystemPromptsMigration,
  migrateTagStylesToTagsMigration,
  // Plugin system migrations
  removeQuilltapRPBuiltinMigration,
  // Character unification
  migratePersonasToCharactersMigration,
  // Multi-character chat migrations
  addMultiCharacterFieldsMigration,
  addInterCharacterMemoryFieldsMigration,
  // Token usage tracking
  addTokenTrackingFieldsMigration,
  // Web search decoupling
  addUseNativeWebSearchFieldMigration,
  // S3 key restructuring
  restructureS3KeysMigration,
  // Memory aboutCharacterId population
  populateMemoryAboutCharacterIdsMigration,
  // Mount points migration
  createMountPointsMigration,
  // Per-project mount points
  perProjectMountPointsMigration,
  // Folder entities migration
  createFolderEntitiesMigration,
  // Fix orphan PERSONA participants
  fixOrphanPersonaParticipantsMigration,
  // Fix missing storage keys
  fixMissingStorageKeysMigration,
  // Cleanup orphan file records
  cleanupOrphanFileRecordsMigration,
];

export {
  convertOpenRouterProfilesMigration,
  enableProviderPluginsMigration,
  // Phase 3: MongoDB + S3 Migration System
  validateMongoDBConfigMigration,
  validateS3ConfigMigration,
  migrateJsonToMongoDBMigration,
  migrateFilesToS3Migration,
  // Data integrity migrations
  ensureUserUsernamesMigration,
  inheritFileTagsMigration,
  migrateCharacterSystemPromptsMigration,
  migrateTagStylesToTagsMigration,
  // Plugin system migrations
  removeQuilltapRPBuiltinMigration,
  // Character unification
  migratePersonasToCharactersMigration,
  // Multi-character chat migrations
  addMultiCharacterFieldsMigration,
  addInterCharacterMemoryFieldsMigration,
  // Token usage tracking
  addTokenTrackingFieldsMigration,
  // Web search decoupling
  addUseNativeWebSearchFieldMigration,
  // S3 key restructuring
  restructureS3KeysMigration,
  // Memory aboutCharacterId population
  populateMemoryAboutCharacterIdsMigration,
  // Mount points migration
  createMountPointsMigration,
  // Per-project mount points
  perProjectMountPointsMigration,
  // Folder entities migration
  createFolderEntitiesMigration,
  // Fix orphan PERSONA participants
  fixOrphanPersonaParticipantsMigration,
  // Fix missing storage keys
  fixMissingStorageKeysMigration,
  // Cleanup orphan file records
  cleanupOrphanFileRecordsMigration,
};
