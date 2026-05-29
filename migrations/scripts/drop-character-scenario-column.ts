/**
 * Migration: Drop the dead singular `scenario` column from characters
 *
 * The `characters` table carried a singular `scenario TEXT` column that
 * predates the `scenarios[]` array (the array was dropped into the vault by
 * `cutover-characters-to-vault-v1`). Nothing in the repository row-mapping,
 * the `Character` type, or its Zod schema reads or writes this singular
 * column — it has been dead legacy since the scenarios array landed, and the
 * 4.6 vault cutover left it untouched because it was never part of the
 * content-field set. This migration removes it so the schema stops carrying
 * a column no code path touches.
 *
 * Migration ID: drop-character-scenario-column-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

const MIGRATION_ID = 'drop-character-scenario-column-v1';

export const dropCharacterScenarioColumnMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Drop the dead singular scenario column from the characters table',
  introducedInVersion: '4.6.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }
    if (!sqliteTableExists('characters')) {
      return false;
    }
    const columnNames = getSQLiteTableColumns('characters').map((col) => col.name);
    return columnNames.includes('scenario');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    const ctx = { context: `migration.${MIGRATION_ID}` };
    let columnsDropped = 0;

    try {
      const db = getSQLiteDatabase();
      const columnNames = getSQLiteTableColumns('characters').map((col) => col.name);

      if (columnNames.includes('scenario')) {
        db.exec('ALTER TABLE "characters" DROP COLUMN "scenario"');
        columnsDropped++;
        logger.info('Dropped dead singular scenario column from characters table', ctx);
      } else {
        logger.debug('scenario column already absent from characters table; nothing to drop', ctx);
      }

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: columnsDropped,
        message: columnsDropped
          ? 'Dropped dead singular scenario column from characters table'
          : 'scenario column already absent; nothing to drop',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to drop scenario column from characters table', {
        ...ctx,
        error: errorMessage,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: columnsDropped,
        message: 'Failed to drop scenario column from characters table',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
