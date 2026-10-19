/**
 * Migration: Add Character Inventory Flag
 *
 * Adds `characters.canManageInventory` (INTEGER, default NULL): whether the
 * character is offered the `inventory_*` tools. NULL reads as on, as
 * `canDressThemselves` does. No backfill.
 *
 * Migration ID: add-character-inventory-flag-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
} from '../lib/database-utils';

const MIGRATION_ID = 'add-character-inventory-flag-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;

export const addCharacterInventoryFlagMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Add canManageInventory to characters (gates the inventory_* tools)',
  introducedInVersion: '4.11.0',
  dependsOn: ['add-character-wardrobe-flags-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('characters')) return false;
    return !sqliteColumnExists('characters', 'canManageInventory');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    try {
      const added = addColumnIfMissing('characters', 'canManageInventory', 'INTEGER DEFAULT NULL');
      if (added) {
        logger.info('Added canManageInventory column to characters', { context: LOG_CONTEXT });
      }
      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: added ? 1 : 0,
        message: 'Added canManageInventory column to characters',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to add canManageInventory column to characters', {
        context: LOG_CONTEXT,
        error: errorMessage,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to add canManageInventory column to characters',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
