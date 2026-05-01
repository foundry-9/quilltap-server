/**
 * Migration: Add Character Manifesto Field
 *
 * Adds a `manifesto` column to the characters table. The manifesto contains
 * the basic tenets — the most important facts of the character's existence.
 * The axiomatic core that every other field should remain consistent with.
 * Distinct from `identity` (public-knowledge view), `description` (acquaintance-perceivable
 * behaviour), and `personality` (character's own self-knowledge).
 *
 * Stored as TEXT, nullable (null = not set).
 *
 * Migration ID: add-character-manifesto-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addCharacterManifestoFieldMigration: Migration = {
  id: 'add-character-manifesto-field-v1',
  description: 'Add manifesto field to characters table',
  introducedInVersion: '4.5.0',
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

    return !columnNames.includes('manifesto');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      if (sqliteTableExists('characters')) {
        const columns = getSQLiteTableColumns('characters');
        const columnNames = columns.map((col) => col.name);

        if (!columnNames.includes('manifesto')) {
          db.exec(`ALTER TABLE "characters" ADD COLUMN "manifesto" TEXT`);
          columnsAdded++;
          logger.info('Added manifesto column to characters table', {
            context: 'migration.add-character-manifesto-field',
          });
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('Character manifesto field migration completed', {
        context: 'migration.add-character-manifesto-field',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-character-manifesto-field-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} column(s) to characters table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add character manifesto field', {
        context: 'migration.add-character-manifesto-field',
        error: errorMessage,
      });

      return {
        id: 'add-character-manifesto-field-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add character manifesto field',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
