/**
 * Migration: Drop wardrobe_items Table
 *
 * Snapshots the contents of wardrobe_items to a JSON backup file in the data
 * directory, then drops its index and the table itself. Wardrobe items now live
 * exclusively in the document store (the character vault's `Wardrobe/*.md`
 * folder, Quilltap General for shared archetypes, and project stores); the
 * `wardrobe_items` DB mirror and its sync-back machinery have been removed.
 *
 * Two-startup safety sequence
 * ---------------------------
 * Migrations run BEFORE startup tasks. The two one-time tasks that populate the
 * vaults from the (about-to-be-dropped) DB rows — `refresh-vault-wardrobe`
 * (DB → vault projection) and `move-shared-wardrobe-to-general` (relocates
 * shared archetypes into Quilltap General) — are startup tasks, each recording
 * a flag in `instance_settings` when it completes.
 *
 * Therefore, on the FIRST startup after upgrade this migration's `shouldRun`
 * returns false (the flags aren't set yet); the startup tasks then run and set
 * the flags. On the NEXT startup the flags are present and the migration drops
 * the table. Gating on BOTH flags is the safety interlock: it guarantees every
 * character-owned item has been projected into its vault AND every shared
 * archetype has been moved into Quilltap General before the rows disappear.
 *
 * Migration ID: drop-wardrobe-items-table-v1
 */

import fs from 'fs';
import path from 'path';
import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  querySQLite,
} from '../lib/database-utils';
import { getBaseDataDir } from '../../lib/paths';

const WARDROBE_FOLDER_FLAG = 'wardrobe_folder_migrated_v1';
const SHARED_MOVED_FLAG = 'shared_wardrobe_moved_to_general_v1';

/**
 * Read a boolean-ish flag from instance_settings, defensively returning false
 * if the table doesn't exist yet (querySQLite would otherwise throw).
 */
function isInstanceFlagSet(key: string): boolean {
  if (!sqliteTableExists('instance_settings')) {
    return false;
  }
  const rows = querySQLite<{ value: string }>(
    `SELECT value FROM instance_settings WHERE key = ?`,
    [key],
  );
  return rows[0]?.value === 'true';
}

export const dropWardrobeItemsTableMigration: Migration = {
  id: 'drop-wardrobe-items-table-v1',
  description:
    'Drop wardrobe_items table (after backing up its rows to a JSON snapshot)',
  introducedInVersion: '4.7.0',
  dependsOn: ['migrate-outfit-presets-to-composites-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }
    if (!sqliteTableExists('wardrobe_items')) {
      return false;
    }
    // Safety interlock — only drop once BOTH one-time population passes (startup
    // tasks, which run after migrations) have completed. See the header comment.
    return (
      isInstanceFlagSet(WARDROBE_FOLDER_FLAG) && isInstanceFlagSet(SHARED_MOVED_FLAG)
    );
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let droppedTables = 0;
    let backupRowCount = 0;

    try {
      const db = getSQLiteDatabase();

      logger.info('Starting wardrobe_items table drop', {
        context: 'migration.drop-wardrobe-items-table',
      });

      if (!sqliteTableExists('wardrobe_items')) {
        logger.info('wardrobe_items table already absent; nothing to do', {
          context: 'migration.drop-wardrobe-items-table',
        });
        const durationMs = Date.now() - startTime;
        return {
          id: 'drop-wardrobe-items-table-v1',
          success: true,
          itemsAffected: 0,
          message: 'wardrobe_items table already absent',
          durationMs,
          timestamp: new Date().toISOString(),
        };
      }

      // Snapshot rows before dropping. Always write the snapshot file (even if
      // there are zero rows) so the operator can confirm the migration ran.
      // `SELECT *` captures every column, including any added by later
      // migrations (e.g. componentItemIds).
      const rows = db.prepare(`SELECT * FROM wardrobe_items`).all() as Array<
        Record<string, unknown>
      >;
      backupRowCount = rows.length;

      const backupDir = path.join(getBaseDataDir(), 'backup');
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      const backupPath = path.join(backupDir, 'pre-drop-wardrobe-items.json');

      const payload = {
        droppedAt: new Date().toISOString(),
        rowCount: backupRowCount,
        rows,
      };
      fs.writeFileSync(backupPath, JSON.stringify(payload, null, 2), 'utf8');

      logger.info('Wrote wardrobe_items snapshot before dropping table', {
        context: 'migration.drop-wardrobe-items-table',
        backupPath,
        rowCount: backupRowCount,
      });

      // Drop the index first (idempotent), then the table.
      db.exec(`DROP INDEX IF EXISTS "idx_wardrobe_items_character"`);
      db.exec(`DROP TABLE IF EXISTS "wardrobe_items"`);
      droppedTables = 1;

      logger.info('Dropped wardrobe_items table and its index', {
        context: 'migration.drop-wardrobe-items-table',
      });

      const durationMs = Date.now() - startTime;

      logger.info('Drop wardrobe_items migration completed', {
        context: 'migration.drop-wardrobe-items-table',
        droppedTables,
        backupRowCount,
        durationMs,
      });

      return {
        id: 'drop-wardrobe-items-table-v1',
        success: true,
        itemsAffected: backupRowCount,
        message: `Dropped wardrobe_items table (snapshot of ${backupRowCount} row(s) at ${backupPath})`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to drop wardrobe_items table', {
        context: 'migration.drop-wardrobe-items-table',
        error: errorMessage,
      });

      return {
        id: 'drop-wardrobe-items-table-v1',
        success: false,
        itemsAffected: backupRowCount,
        message: 'Failed to drop wardrobe_items table',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
