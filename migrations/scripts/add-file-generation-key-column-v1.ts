/**
 * Migration: Add Generation Key Column
 *
 * Adds `files.generationKey` — the avatar configuration cache key. It is the
 * hash of everything deterministic about the generation that produced a file:
 * the prompt (itself already the canonical serialization of the character's
 * appearance, resolved outfit and art direction) plus the provider, profile,
 * model and built params that shape the picture without changing the prompt.
 *
 * Nullable, because only cached-avatar rows ever carry one — every other file
 * in the table leaves it null. The index is what makes the pre-generation
 * lookup cheap enough to run on every avatar job.
 *
 * Backfilling the existing rows is a separate job with its own
 * consequences — see `collapse-duplicate-avatar-rolls-v1`, which runs next.
 *
 * Migration ID: add-file-generation-key-column-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
  executeSQLite,
} from '../lib/database-utils';

const MIGRATION_ID = 'add-file-generation-key-column-v1';

export const addFileGenerationKeyColumnMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Add generationKey column and index to files table',
  introducedInVersion: '4.10.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('files')) {
      return false;
    }

    return !sqliteColumnExists('files', 'generationKey');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const added = addColumnIfMissing('files', 'generationKey', 'TEXT');

      executeSQLite(
        'CREATE INDEX IF NOT EXISTS "idx_files_generationKey" ON "files" ("generationKey");'
      );

      const durationMs = Date.now() - startTime;

      logger.info('Added generationKey column to files table', {
        context: 'migration.add-file-generation-key-column',
        durationMs,
      });

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: added ? 1 : 0,
        message: 'Added generationKey column and index to files table',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add generationKey column', {
        context: 'migration.add-file-generation-key-column',
        error: errorMessage,
      });

      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to add generationKey column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
