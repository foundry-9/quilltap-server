/**
 * Migration: Add Character Memory-Editing Flag
 *
 * Adds `characters.canEditMemories` (INTEGER, default NULL): whether the
 * character is offered the `read_memory` and `edit_memory` tools. NULL reads
 * as off, as `defaultHelpToolsEnabled` does: editing its own memories is a
 * permission the operator grants. No backfill.
 *
 * Migration ID: add-character-memory-edit-flag-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
} from '../lib/database-utils';

const MIGRATION_ID = 'add-character-memory-edit-flag-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;

export const addCharacterMemoryEditFlagMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Add canEditMemories to characters (gates read_memory and edit_memory)',
  introducedInVersion: '4.14.0',
  dependsOn: ['add-character-inventory-flag-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('characters')) return false;
    return !sqliteColumnExists('characters', 'canEditMemories');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    try {
      const added = addColumnIfMissing('characters', 'canEditMemories', 'INTEGER DEFAULT NULL');
      if (added) {
        logger.info('Added canEditMemories column to characters', { context: LOG_CONTEXT });
      }
      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: added ? 1 : 0,
        message: 'Added canEditMemories column to characters',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to add canEditMemories column to characters', {
        context: LOG_CONTEXT,
        error: errorMessage,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to add canEditMemories column to characters',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
