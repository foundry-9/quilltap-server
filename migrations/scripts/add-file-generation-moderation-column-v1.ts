/**
 * Migration: Add Generation Moderation Column
 *
 * Adds `files.generationModeration` — how a generated picture's provider came
 * to draw it, moderation-wise: `moderated`, `uncensored-profile`,
 * `uncensored-routed` or `uncensored-failover` (see `GenerationModerationEnum`
 * in `lib/schemas/file.types.ts`).
 *
 * Nullable, and left null on every existing row: the route a past picture
 * took was never recorded, so there is nothing honest to backfill. New
 * avatars, story backgrounds and image-tool / dialog pictures carry it.
 *
 * Migration ID: add-file-generation-moderation-column-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
} from '../lib/database-utils';

const MIGRATION_ID = 'add-file-generation-moderation-column-v1';

export const addFileGenerationModerationColumnMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Add generationModeration column to files table',
  introducedInVersion: '4.14.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('files')) {
      return false;
    }

    return !sqliteColumnExists('files', 'generationModeration');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const added = addColumnIfMissing('files', 'generationModeration', 'TEXT');
      const durationMs = Date.now() - startTime;

      logger.info('Added generationModeration column to files table', {
        context: 'migration.add-file-generation-moderation-column',
        added,
        durationMs,
      });

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: added ? 1 : 0,
        message: 'Added generationModeration column to files table',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add generationModeration column', {
        context: 'migration.add-file-generation-moderation-column',
        error: errorMessage,
      });

      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to add generationModeration column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
