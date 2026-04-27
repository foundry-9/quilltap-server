/**
 * Migration: Add Character System Transparency Field
 *
 * Adds the systemTransparency column to the characters table. When the column
 * is non-true (NULL or 0) the character cannot perceive "the Staff" — the
 * self_inventory tool is withheld, Staff messages (Lantern/Aurora/Librarian/
 * Prospero/Host) are filtered from their LLM context, and every character vault
 * (their own and peers') is hidden from doc_* tools. The character-level flag
 * is a hard override on top of any chat- or project-level toggles for those
 * three features. Default NULL so existing characters stay opaque until the
 * user opts them in.
 *
 * Stored as INTEGER (boolean), default NULL.
 *
 * Migration ID: add-character-system-transparency-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addCharacterSystemTransparencyFieldMigration: Migration = {
  id: 'add-character-system-transparency-field-v1',
  description: 'Add systemTransparency column to characters table',
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

    return !columnNames.includes('systemTransparency');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      if (sqliteTableExists('characters')) {
        const columns = getSQLiteTableColumns('characters');
        const columnNames = columns.map((col) => col.name);

        if (!columnNames.includes('systemTransparency')) {
          db.exec(`ALTER TABLE "characters" ADD COLUMN "systemTransparency" INTEGER DEFAULT NULL`);
          columnsAdded++;
          logger.info('Added systemTransparency column to characters table', {
            context: 'migration.add-character-system-transparency-field',
          });
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('Character systemTransparency migration completed', {
        context: 'migration.add-character-system-transparency-field',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-character-system-transparency-field-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} column(s) to characters table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add systemTransparency column to characters', {
        context: 'migration.add-character-system-transparency-field',
        error: errorMessage,
      });

      return {
        id: 'add-character-system-transparency-field-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add systemTransparency column to characters',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
