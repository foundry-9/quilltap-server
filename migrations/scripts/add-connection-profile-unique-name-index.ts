/**
 * Migration: Enforce Unique Connection-Profile Names
 *
 * Connection-profile names are the load-bearing identifier in the Salon's
 * participant model picker (two profiles can share a provider+model but differ
 * in settings — only the name tells them apart). This migration makes names
 * unique per user, case-insensitively and ignoring surrounding whitespace.
 *
 * It runs in two steps:
 *   1. De-duplicate any existing colliding names — the oldest profile keeps its
 *      name; later ones gain a " (2)", " (3)", … suffix.
 *   2. Create an expression UNIQUE INDEX on (userId, lower(trim(name))), which
 *      mirrors normalizeProfileName() in lib/llm/connection-profile-names.ts.
 *
 * Migration ID: add-connection-profile-unique-name-index-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';
import { normalizeProfileName, makeUniqueProfileName } from '@/lib/llm/connection-profile-names';

const MIGRATION_ID = 'add-connection-profile-unique-name-index-v1';
const INDEX_NAME = 'idx_connection_profiles_userId_name';

function indexExists(): boolean {
  const db = getSQLiteDatabase();
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(INDEX_NAME);
  return !!row;
}

/**
 * Enforce Unique Connection-Profile Names Migration
 */
export const addConnectionProfileUniqueNameIndexMigration: Migration = {
  id: MIGRATION_ID,
  description: 'De-duplicate connection-profile names and add a unique index on (userId, lower(trim(name)))',
  introducedInVersion: '4.7.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('connection_profiles')) {
      return false;
    }

    return !indexExists();
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      // 1. De-duplicate existing names so the unique index can be created.
      //    Oldest profile (by createdAt) keeps its name; later collisions get a
      //    numeric suffix. Scope the "taken" set by userId to match the index
      //    and stay correct on any legacy multi-row data.
      const profiles = db
        .prepare('SELECT id, userId, name FROM connection_profiles ORDER BY createdAt ASC, id ASC')
        .all() as Array<{ id: string; userId: string; name: string }>;

      const updateName = db.prepare(
        'UPDATE connection_profiles SET name = ?, updatedAt = ? WHERE id = ?'
      );
      const takenByUser = new Map<string, Set<string>>();
      let renamed = 0;

      for (let i = 0; i < profiles.length; i++) {
        const profile = profiles[i];

        let taken = takenByUser.get(profile.userId);
        if (!taken) {
          taken = new Set<string>();
          takenByUser.set(profile.userId, taken);
        }

        const uniqueName = makeUniqueProfileName(profile.name, taken);
        if (uniqueName !== profile.name) {
          updateName.run(uniqueName, new Date().toISOString(), profile.id);
          renamed++;
          logger.debug('Renamed duplicate connection-profile name', {
            context: 'migration.add-connection-profile-unique-name-index',
            profileId: profile.id,
            from: profile.name,
            to: uniqueName,
          });
        }
        taken.add(normalizeProfileName(uniqueName));

        reportProgress(i + 1, profiles.length, 'profiles');
      }

      // 2. Create the case-insensitive, trimmed unique index.
      db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS "${INDEX_NAME}" ` +
          'ON "connection_profiles" ("userId", lower(trim("name")))'
      );

      // 3. Verify the index landed.
      if (!indexExists()) {
        throw new Error('Unique index was not created');
      }

      logger.info('Enforced unique connection-profile names', {
        context: 'migration.add-connection-profile-unique-name-index',
        profileCount: profiles.length,
        renamed,
      });

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: renamed,
        message: `Created unique connection-profile name index (renamed ${renamed} duplicate name${renamed === 1 ? '' : 's'})`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Failed to enforce unique connection-profile names', {
        context: 'migration.add-connection-profile-unique-name-index',
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: `Failed to enforce unique connection-profile names: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
