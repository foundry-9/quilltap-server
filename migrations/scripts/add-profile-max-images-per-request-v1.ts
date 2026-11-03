/**
 * Migration: Add maxImagesPerRequest Field to Connection Profiles
 *
 * Adds `connection_profiles.maxImagesPerRequest` (INTEGER, DEFAULT 4): the
 * most images a vision-capable profile is sent in one request. Some models
 * refuse a request carrying more than four images outright, and a Salon turn
 * can gather more than that (uploads, unseen uploads re-sent, Lantern images
 * since the character last spoke). Read only through
 * `resolveMaxImagesPerRequest()` in `lib/llm/connection-profile-utils.ts`.
 *
 * Backfill: every existing row gets 4, the documented default.
 *
 * Migration ID: add-profile-max-images-per-request-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
} from '../lib/database-utils';

const MIGRATION_ID = 'add-profile-max-images-per-request-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;

export const addProfileMaxImagesPerRequestMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Add maxImagesPerRequest column to connection_profiles (cap on images sent in one request)',
  introducedInVersion: '4.12.0',
  dependsOn: ['add-profile-supports-image-upload-field-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('connection_profiles')) return false;
    return !sqliteColumnExists('connection_profiles', 'maxImagesPerRequest');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    try {
      const added = addColumnIfMissing('connection_profiles', 'maxImagesPerRequest', 'INTEGER DEFAULT 4');
      const backfilled = getSQLiteDatabase()
        .prepare('UPDATE "connection_profiles" SET "maxImagesPerRequest" = 4 WHERE "maxImagesPerRequest" IS NULL')
        .run().changes;
      logger.info('Added connection_profiles.maxImagesPerRequest column', {
        context: LOG_CONTEXT,
        added,
        backfilled,
      });
      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: backfilled,
        message: added
          ? `Added maxImagesPerRequest column to connection_profiles (${backfilled} row(s) backfilled)`
          : 'maxImagesPerRequest column already present',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to add maxImagesPerRequest column', { context: LOG_CONTEXT, error: errorMessage });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to add maxImagesPerRequest column',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
