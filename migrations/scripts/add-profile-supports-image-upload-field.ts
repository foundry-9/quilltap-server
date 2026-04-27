/**
 * Migration: Add supportsImageUpload Field to Connection Profiles
 *
 * Adds the supportsImageUpload boolean column and seeds it based on the
 * previously hardcoded per-provider capability map so existing profiles
 * retain their current behavior. Providers that historically supported
 * image input in Quilltap (OpenAI, Anthropic, Google, Grok) are seeded
 * to 1; all others default to 0. Users can toggle the flag per profile,
 * which is how OpenRouter/Ollama/OpenAI-compatible profiles pointing at
 * vision-capable models can opt in.
 *
 * Migration ID: add-profile-supports-image-upload-field-v1
 */
import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

const VISION_SEED_PROVIDERS = ['OPENAI', 'ANTHROPIC', 'GOOGLE', 'GROK'] as const;

export const addProfileSupportsImageUploadFieldMigration: Migration = {
  id: 'add-profile-supports-image-upload-field-v1',
  description: 'Add supportsImageUpload field to connection profiles and seed historic vision providers',
  introducedInVersion: '3.1.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('connection_profiles')) {
      return false;
    }

    const columns = getSQLiteTableColumns('connection_profiles');
    const hasColumn = columns.some((col) => col.name === 'supportsImageUpload');
    return !hasColumn;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();
      db.exec('ALTER TABLE "connection_profiles" ADD COLUMN "supportsImageUpload" INTEGER DEFAULT 0');

      const placeholders = VISION_SEED_PROVIDERS.map(() => '?').join(',');
      const seedResult = db
        .prepare(`UPDATE "connection_profiles" SET "supportsImageUpload" = 1 WHERE "provider" IN (${placeholders})`)
        .run(...VISION_SEED_PROVIDERS);

      const columns = getSQLiteTableColumns('connection_profiles');
      const hasColumn = columns.some((col) => col.name === 'supportsImageUpload');

      if (!hasColumn) {
        throw new Error('Column was not added successfully');
      }

      logger.info('Added supportsImageUpload column to connection_profiles', {
        context: 'migration.add-profile-supports-image-upload-field',
        seededProfiles: seedResult.changes,
      });

      return {
        id: 'add-profile-supports-image-upload-field-v1',
        success: true,
        itemsAffected: seedResult.changes,
        message: `Added supportsImageUpload column and seeded ${seedResult.changes} existing profile(s)`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Failed to add supportsImageUpload column', {
        context: 'migration.add-profile-supports-image-upload-field',
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        id: 'add-profile-supports-image-upload-field-v1',
        success: false,
        itemsAffected: 0,
        message: `Failed to add supportsImageUpload column: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
