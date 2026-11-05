/**
 * Migration: Add toolResultVerbatimTurns Field to Connection Profiles
 *
 * Adds `connection_profiles.toolResultVerbatimTurns` (INTEGER, DEFAULT 3): how
 * many turns a tool result is sent to the profile in full before its body is
 * replaced by a short stub in the history. `0` keeps every result in full.
 * Three turns was the fixed rule for every provider; eliding trims the
 * context but rewrites the history part-way up, which re-writes a provider's
 * prompt cache from that point, so it is now chosen per profile. Read only
 * through `resolveToolResultVerbatimTurns()` in
 * `lib/llm/connection-profile-utils.ts`.
 *
 * Backfill: every existing row gets 3, the previous fixed rule.
 *
 * Migration ID: add-profile-tool-result-verbatim-turns-v1
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

const MIGRATION_ID = 'add-profile-tool-result-verbatim-turns-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;

export const addProfileToolResultVerbatimTurnsMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Add toolResultVerbatimTurns column to connection_profiles (turns a tool result stays in full)',
  introducedInVersion: '4.13.0',
  dependsOn: ['add-profile-max-images-per-request-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('connection_profiles')) return false;
    return !sqliteColumnExists('connection_profiles', 'toolResultVerbatimTurns');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    try {
      const added = addColumnIfMissing('connection_profiles', 'toolResultVerbatimTurns', 'INTEGER DEFAULT 3');
      const backfilled = getSQLiteDatabase()
        .prepare('UPDATE "connection_profiles" SET "toolResultVerbatimTurns" = 3 WHERE "toolResultVerbatimTurns" IS NULL')
        .run().changes;
      logger.info('Added connection_profiles.toolResultVerbatimTurns column', {
        context: LOG_CONTEXT,
        added,
        backfilled,
      });
      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: backfilled,
        message: added
          ? `Added toolResultVerbatimTurns column to connection_profiles (${backfilled} row(s) backfilled)`
          : 'toolResultVerbatimTurns column already present',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to add toolResultVerbatimTurns column', { context: LOG_CONTEXT, error: errorMessage });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to add toolResultVerbatimTurns column',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
