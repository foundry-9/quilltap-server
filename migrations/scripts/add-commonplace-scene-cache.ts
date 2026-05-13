/**
 * Migration: Add Commonplace Book scene-state emission cache to chats.
 *
 * The Commonplace Book emits a per-turn whisper that opens with a `Current
 * State` block — location, time, then every present character's action and
 * clothing in full prose. The clothing prose is by far the heaviest bit
 * (often several hundred tokens per character), and in long scenes it
 * almost never changes between turns. Every LLM call (API or Courier)
 * pays that cost again and again.
 *
 * This cache lets `formatCurrentSceneState` short-circuit a character's
 * block to `### Name — _unchanged_` when their action + clothing hashes
 * match what was last emitted to the same target. The cache is keyed by
 * the whisper's target participant ID (or `__public__` when untargeted,
 * single-character chats), then by character ID:
 *
 *   { [targetKey]: { [characterId]: { actionHash, clothingHash, emittedAt } } }
 *
 * Migration ID: add-commonplace-scene-cache-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addCommonplaceSceneCacheMigration: Migration = {
  id: 'add-commonplace-scene-cache-v1',
  description: 'Add commonplaceSceneCache column to chats for per-target scene-state diffing',
  introducedInVersion: '4.5.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chats')) {
      return false;
    }

    const cols = getSQLiteTableColumns('chats').map((c) => c.name);
    return !cols.includes('commonplaceSceneCache');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();
      db.exec(`ALTER TABLE "chats" ADD COLUMN "commonplaceSceneCache" TEXT DEFAULT NULL`);

      logger.info('Added commonplaceSceneCache column to chats', {
        context: 'migration.add-commonplace-scene-cache',
      });

      return {
        id: 'add-commonplace-scene-cache-v1',
        success: true,
        itemsAffected: 1,
        message: 'Added commonplaceSceneCache column to chats',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add commonplaceSceneCache column', {
        context: 'migration.add-commonplace-scene-cache',
        error: errorMessage,
      });

      return {
        id: 'add-commonplace-scene-cache-v1',
        success: false,
        itemsAffected: 0,
        message: `Failed to add commonplaceSceneCache column: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
