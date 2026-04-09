/**
 * Migration: Rename Persona DB Columns
 *
 * Removes the last vestiges of the persona concept from the database schema:
 *
 * 1. characters table: RENAME COLUMN personaLinks → partnerLinks
 *    Also updates JSON content: {personaId: "..."} → {partnerId: "..."}
 *
 * 2. memories table: DROP COLUMN personaId
 *    Data was already migrated to aboutCharacterId by a previous migration.
 *    Any remaining non-null personaId values are copied to aboutCharacterId first.
 *
 * SQLite 3.35+ supports ALTER TABLE RENAME COLUMN and DROP COLUMN,
 * and better-sqlite3 bundles SQLite 3.45+, so this is safe.
 *
 * Migration ID: rename-persona-columns-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

const MIGRATION_ID = 'rename-persona-columns-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;

/**
 * Check if there is work to do
 */
function needsWork(): boolean {
  if (!isSQLiteBackend()) {
    return false;
  }

  // Check characters table for personaLinks column
  if (sqliteTableExists('characters')) {
    const charCols = getSQLiteTableColumns('characters');
    if (charCols.some(c => c.name === 'personaLinks')) {
      return true;
    }
  }

  // Check memories table for personaId column
  if (sqliteTableExists('memories')) {
    const memCols = getSQLiteTableColumns('memories');
    if (memCols.some(c => c.name === 'personaId')) {
      return true;
    }
  }

  return false;
}

/**
 * Run migration
 */
function runMigration(): MigrationResult {
  const startTime = Date.now();
  let itemsAffected = 0;

  try {
    const db = getSQLiteDatabase();

    // ========================================================================
    // 1. Characters: personaLinks → partnerLinks
    // ========================================================================
    if (sqliteTableExists('characters')) {
      const charCols = getSQLiteTableColumns('characters');
      if (charCols.some(c => c.name === 'personaLinks')) {
        // First, update JSON content: {personaId: "..."} → {partnerId: "..."}
        // personaLinks is a JSON array like [{"personaId":"abc","isDefault":true}]
        const chars = db.prepare(
          `SELECT id, personaLinks FROM characters WHERE personaLinks IS NOT NULL AND personaLinks != '[]'`
        ).all() as Array<{ id: string; personaLinks: string }>;

        for (const char of chars) {
          try {
            const links = JSON.parse(char.personaLinks);
            if (Array.isArray(links) && links.length > 0) {
              const updated = links.map((link: { personaId: string; isDefault: boolean }) => ({
                partnerId: link.personaId,
                isDefault: link.isDefault,
              }));
              db.prepare('UPDATE characters SET personaLinks = ? WHERE id = ?')
                .run(JSON.stringify(updated), char.id);
              itemsAffected++;
            }
          } catch {
            // Skip malformed JSON
            logger.warn('Skipping malformed personaLinks JSON', {
              context: LOG_CONTEXT,
              characterId: char.id,
            });
          }
        }

        // Rename the column
        db.exec('ALTER TABLE characters RENAME COLUMN personaLinks TO partnerLinks');
        itemsAffected++;
        logger.info('Renamed personaLinks to partnerLinks in characters table', {
          context: LOG_CONTEXT,
          jsonUpdated: chars.length,
        });
      }
    }

    // ========================================================================
    // 2. Memories: drop personaId (migrate any stragglers first)
    // ========================================================================
    if (sqliteTableExists('memories')) {
      const memCols = getSQLiteTableColumns('memories');
      if (memCols.some(c => c.name === 'personaId')) {
        // Copy any remaining personaId values to aboutCharacterId
        const migrated = db.prepare(
          `UPDATE memories SET aboutCharacterId = personaId
           WHERE personaId IS NOT NULL AND (aboutCharacterId IS NULL OR aboutCharacterId = '')`
        ).run();

        if (migrated.changes > 0) {
          logger.info('Migrated straggler personaId values to aboutCharacterId', {
            context: LOG_CONTEXT,
            count: migrated.changes,
          });
          itemsAffected += migrated.changes;
        }

        // Drop the column
        db.exec('ALTER TABLE memories DROP COLUMN personaId');
        itemsAffected++;
        logger.info('Dropped personaId column from memories table', {
          context: LOG_CONTEXT,
        });
      }
    }

    const durationMs = Date.now() - startTime;

    return {
      id: MIGRATION_ID,
      success: true,
      itemsAffected,
      message: `Renamed persona columns: ${itemsAffected} schema/data changes`,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Rename persona columns migration failed', {
      context: LOG_CONTEXT,
      error: errorMessage,
    });

    return {
      id: MIGRATION_ID,
      success: false,
      itemsAffected,
      message: `Migration failed: ${errorMessage}`,
      error: errorMessage,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Rename Persona Columns Migration
 */
export const renamePersonaColumnsMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Rename personaLinks → partnerLinks in characters, drop personaId from memories',
  introducedInVersion: '4.2.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }
    return needsWork();
  },

  async run(): Promise<MigrationResult> {
    logger.info('Starting rename persona columns migration', {
      context: LOG_CONTEXT,
    });
    return runMigration();
  },
};
