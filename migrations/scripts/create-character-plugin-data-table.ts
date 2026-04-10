/**
 * Migration: Create Character Plugin Data Table
 *
 * Creates the character_plugin_data table for per-character, per-plugin
 * metadata storage. Each plugin can store arbitrary JSON data associated
 * with a character.
 *
 * Migration ID: create-character-plugin-data-table-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';

/**
 * Create Character Plugin Data Table Migration
 */
export const createCharacterPluginDataTableMigration: Migration = {
  id: 'create-character-plugin-data-table-v1',
  description: 'Create character_plugin_data table for per-character per-plugin metadata',
  introducedInVersion: '4.3.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    // Always return true if we haven't been recorded as completed yet.
    // The table may already exist if auto-created by the repository layer
    // (ensureCollection), but we still need to run to ensure indexes exist
    // and to be recorded in migrations_state so dependent migrations can proceed.
    return true;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let itemsAffected = 0;

    try {
      const db = getSQLiteDatabase();

      if (!sqliteTableExists('character_plugin_data')) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS "character_plugin_data" (
            "id" TEXT PRIMARY KEY,
            "characterId" TEXT NOT NULL,
            "pluginName" TEXT NOT NULL,
            "data" TEXT NOT NULL DEFAULT '{}',
            "createdAt" TEXT NOT NULL,
            "updatedAt" TEXT NOT NULL,
            UNIQUE("characterId", "pluginName"),
            FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE CASCADE
          );
        `);
        itemsAffected++;
        logger.info('Created character_plugin_data table', {
          context: 'migration.create-character-plugin-data-table',
        });
      }

      // Ensure indexes exist even if table was auto-created
      db.exec(`
        CREATE INDEX IF NOT EXISTS "idx_cpd_character" ON "character_plugin_data"("characterId");
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS "idx_cpd_plugin" ON "character_plugin_data"("pluginName");
      `);
      logger.info('Ensured indexes on character_plugin_data', {
        context: 'migration.create-character-plugin-data-table',
      });

      const durationMs = Date.now() - startTime;

      logger.info('Character plugin data table migration completed', {
        context: 'migration.create-character-plugin-data-table',
        itemsAffected,
        durationMs,
      });

      return {
        id: 'create-character-plugin-data-table-v1',
        success: true,
        itemsAffected,
        message: `Created character_plugin_data table with indexes`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to create character_plugin_data table', {
        context: 'migration.create-character-plugin-data-table',
        error: errorMessage,
      });

      return {
        id: 'create-character-plugin-data-table-v1',
        success: false,
        itemsAffected,
        message: 'Failed to create character_plugin_data table',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
