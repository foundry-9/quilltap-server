/**
 * Migration: Add Chat Scenario Source Columns
 *
 * Adds two columns to the chats table so a chat remembers where its scene
 * came from, beside the resolved text it already keeps:
 * - scenarioSource (TEXT, default NULL) — JSON `{ mountPointId, path,
 *   bodySha256 }`: the scenario file the preset was read from and the hash of
 *   its body at pick time
 * - scenarioNotes (TEXT, default NULL) — the free-text notes layered beneath
 *   the preset
 *
 * Written only beside `scenarioText` by `resolveScenarioSelection`'s two
 * callers (chat creation and `?action=scenario`). No backfill: a null source
 * means the in-chat control falls back to inferring the preset by body, as it
 * always has.
 *
 * Migration ID: add-chat-scenario-source-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
} from '../lib/database-utils';

const MIGRATION_ID = 'add-chat-scenario-source-v1';

export const addChatScenarioSourceMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Add scenarioSource and scenarioNotes to chats (where each chat\'s scene was found)',
  introducedInVersion: '4.10.0',
  dependsOn: ['add-chat-scenario-text-field-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chats')) {
      return false;
    }

    return (
      !sqliteColumnExists('chats', 'scenarioSource') ||
      !sqliteColumnExists('chats', 'scenarioNotes')
    );
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      if (addColumnIfMissing('chats', 'scenarioSource', 'TEXT DEFAULT NULL')) {
        columnsAdded++;
      }
      if (addColumnIfMissing('chats', 'scenarioNotes', 'TEXT DEFAULT NULL')) {
        columnsAdded++;
      }

      const durationMs = Date.now() - startTime;

      logger.info('Added the scenario source columns to chats', {
        context: 'migration.add-chat-scenario-source',
        columnsAdded,
        durationMs,
      });

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} scenario source column(s) to chats table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add the scenario source columns', {
        context: 'migration.add-chat-scenario-source',
        error: errorMessage,
      });

      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add the scenario source columns',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
