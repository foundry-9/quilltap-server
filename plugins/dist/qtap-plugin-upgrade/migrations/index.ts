/**
 * Migration Registry
 *
 * All migrations should be imported and exported here.
 * They are executed in dependency order as defined in each migration.
 */

import type { Migration } from '../migration-types';
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
};
