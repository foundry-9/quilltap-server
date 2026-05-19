/**
 * Migration: Add Character Identity Field
 *
 * Adds an `identity` column to the characters table. Identity is the
 * surface-level, public-knowledge view of a character — what strangers can
 * know on sight or by reputation (name, station, occupation, public reputation).
 * Distinct from `description` (acquaintance-perceivable behaviour) and
 * `personality` (the character's own self-knowledge).
 *
 * Stored as TEXT, nullable (null = not set).
 *
 * Migration ID: add-character-identity-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addCharacterIdentityFieldMigration: Migration = {
  id: 'add-character-identity-field-v1',
  description: 'Add identity field to characters table',
  introducedInVersion: '4.4.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('characters')) {
      return false;
    }

    const columns = getSQLiteTableColumns('characters');
    const columnNames = columns.map((col) => col.name);

    return !columnNames.includes('identity');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      if (sqliteTableExists('characters')) {
        const columns = getSQLiteTableColumns('characters');
        const columnNames = columns.map((col) => col.name);

        if (!columnNames.includes('identity')) {
          db.exec(`ALTER TABLE "characters" ADD COLUMN "identity" TEXT`);
          columnsAdded++;
          logger.info('Added identity column to characters table', {
            context: 'migration.add-character-identity-field',
          });
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('Character identity field migration completed', {
        context: 'migration.add-character-identity-field',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-character-identity-field-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} column(s) to characters table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add character identity field', {
        context: 'migration.add-character-identity-field',
        error: errorMessage,
      });

      return {
        id: 'add-character-identity-field-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add character identity field',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
