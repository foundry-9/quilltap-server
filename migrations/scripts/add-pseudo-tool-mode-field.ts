/**
 * Migration: Add pseudoToolMode Field to Connection Profiles
 *
 * This migration adds the `pseudoToolMode` text field to connection_profiles.
 * It selects how tool calls are framed on the wire for a given profile:
 *
 *   - 'auto'        — pick automatically based on model capability (native
 *                     for capable models, simple-json otherwise).
 *   - 'native'      — force native function calling.
 *   - 'simple-json' — `<tool_call>{...}</tool_call>` JSON-in-XML format.
 *   - 'text-block'  — legacy `[[TOOL ...]]content[[/TOOL]]` format.
 *
 * Existing profiles are explicitly set to 'auto' so behaviour matches the
 * pre-migration default. New `auto`-mode profiles on non-native models now
 * select 'simple-json' (this is the spec's Phase 5 flip; the legacy text-block
 * surface stays available behind the explicit 'text-block' override).
 *
 * Migration ID: add-pseudo-tool-mode-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addPseudoToolModeFieldMigration: Migration = {
  id: 'add-pseudo-tool-mode-field-v1',
  description: 'Add pseudoToolMode field to connection profiles for selecting native/simple-json/text-block tool surfaces',
  introducedInVersion: '4.6.0',
  dependsOn: ['add-profile-allow-tool-use-field-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('connection_profiles')) {
      return false;
    }

    const columns = getSQLiteTableColumns('connection_profiles');
    const hasColumn = columns.some((col) => col.name === 'pseudoToolMode');
    return !hasColumn;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      db.exec("ALTER TABLE \"connection_profiles\" ADD COLUMN \"pseudoToolMode\" TEXT DEFAULT 'auto'");

      // Backfill any rows the default may have missed.
      const update = db.prepare(
        "UPDATE \"connection_profiles\" SET \"pseudoToolMode\" = 'auto' WHERE \"pseudoToolMode\" IS NULL"
      );
      const updateResult = update.run();
      const itemsAffected = updateResult.changes ?? 0;

      // Verify
      const columns = getSQLiteTableColumns('connection_profiles');
      const hasColumn = columns.some((col) => col.name === 'pseudoToolMode');

      if (!hasColumn) {
        throw new Error('Column was not added successfully');
      }

      logger.info('Added pseudoToolMode column to connection_profiles', {
        context: 'migration.add-pseudo-tool-mode-field',
        backfilledRows: itemsAffected,
      });

      return {
        id: 'add-pseudo-tool-mode-field-v1',
        success: true,
        itemsAffected,
        message: `Added pseudoToolMode column to connection_profiles table (backfilled ${itemsAffected} rows)`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Failed to add pseudoToolMode column', {
        context: 'migration.add-pseudo-tool-mode-field',
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        id: 'add-pseudo-tool-mode-field-v1',
        success: false,
        itemsAffected: 0,
        message: `Failed to add pseudoToolMode column: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
