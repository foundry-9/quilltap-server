/**
 * Migration: Drop outfit_presets Table
 *
 * Snapshots the contents of outfit_presets to a JSON backup file in the
 * data directory, then drops its index and the table itself. The OutfitPreset
 * entity is being eliminated; preset rows have already been folded into
 * composite wardrobe_items by migrate-outfit-presets-to-composites-v1.
 *
 * Migration ID: drop-outfit-presets-table-v1
 */

import fs from 'fs';
import path from 'path';
import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';
import { getBaseDataDir } from '../../lib/paths';

interface OutfitPresetRow {
  id: string;
  characterId: string | null;
  name: string;
  description: string | null;
  slots: string;
  createdAt: string;
  updatedAt: string;
}

export const dropOutfitPresetsTableMigration: Migration = {
  id: 'drop-outfit-presets-table-v1',
  description:
    'Drop outfit_presets table (after backing up its rows to a JSON snapshot)',
  introducedInVersion: '4.5.0',
  dependsOn: ['convert-equipped-outfit-to-arrays-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    return sqliteTableExists('outfit_presets');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let droppedTables = 0;
    let backupRowCount = 0;

    try {
      const db = getSQLiteDatabase();

      logger.info('Starting outfit_presets table drop', {
        context: 'migration.drop-outfit-presets-table',
      });

      if (!sqliteTableExists('outfit_presets')) {
        logger.info('outfit_presets table already absent; nothing to do', {
          context: 'migration.drop-outfit-presets-table',
        });
        const durationMs = Date.now() - startTime;
        return {
          id: 'drop-outfit-presets-table-v1',
          success: true,
          itemsAffected: 0,
          message: 'outfit_presets table already absent',
          durationMs,
          timestamp: new Date().toISOString(),
        };
      }

      // Snapshot rows before dropping. Always write the snapshot file (even if
      // there are zero rows) so the operator can confirm the migration ran.
      const rows = db
        .prepare(
          `SELECT id, characterId, name, description, slots, createdAt, updatedAt FROM outfit_presets`
        )
        .all() as OutfitPresetRow[];
      backupRowCount = rows.length;

      const backupDir = path.join(getBaseDataDir(), 'backup');
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      const backupPath = path.join(backupDir, 'pre-drop-outfit-presets.json');

      const payload = {
        droppedAt: new Date().toISOString(),
        rowCount: backupRowCount,
        rows,
      };
      fs.writeFileSync(backupPath, JSON.stringify(payload, null, 2), 'utf8');

      logger.info('Wrote outfit_presets snapshot before dropping table', {
        context: 'migration.drop-outfit-presets-table',
        backupPath,
        rowCount: backupRowCount,
      });

      // Drop the index first (idempotent), then the table.
      db.exec(`DROP INDEX IF EXISTS "idx_outfit_presets_character"`);
      db.exec(`DROP TABLE IF EXISTS "outfit_presets"`);
      droppedTables = 1;

      logger.info('Dropped outfit_presets table and its index', {
        context: 'migration.drop-outfit-presets-table',
      });

      const durationMs = Date.now() - startTime;

      logger.info('Drop outfit_presets migration completed', {
        context: 'migration.drop-outfit-presets-table',
        droppedTables,
        backupRowCount,
        durationMs,
      });

      return {
        id: 'drop-outfit-presets-table-v1',
        success: true,
        itemsAffected: backupRowCount,
        message: `Dropped outfit_presets table (snapshot of ${backupRowCount} row(s) at ${backupPath})`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to drop outfit_presets table', {
        context: 'migration.drop-outfit-presets-table',
        error: errorMessage,
      });

      return {
        id: 'drop-outfit-presets-table-v1',
        success: false,
        itemsAffected: backupRowCount,
        message: 'Failed to drop outfit_presets table',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
