/**
 * Migration: Move Memory Maintenance Settings to instance_settings
 *
 * Every memory knob now lives in `instance_settings` behind one façade
 * (`resolveMemorySettings`, memory refactor §3.1, locked decision 9). The
 * last one still on `chat_settings` was `autoHousekeepingSettings`; this
 * migration copies the active user's value into the new
 * `instance_settings.memoryMaintenance` key — keeping `enabled`,
 * `perCharacterCap` and `perCharacterCapOverrides`, dropping the retired
 * `mergeSimilar` / `autoMergeSimilarThreshold` — and then removes what is
 * dead:
 *
 *  - `chat_settings.autoHousekeepingSettings` (moved),
 *  - `chat_settings.memoryExtractionLimits` (superseded by the instance key in
 *    4.4 by `migrate-extraction-knobs-to-instance-settings-v1`, never read since),
 *  - `chat_settings.memoryExtractionConcurrency` (likewise; the runtime cap is the
 *    dispatcher's global one),
 *  - the `instance_settings.memoryExtractionConcurrency` key (read by nothing).
 *
 * Caps are clamped into the bounds the schema now enforces (100–100,000).
 * An existing `memoryMaintenance` key is never overwritten. No index or
 * trigger names the dropped columns, so plain `ALTER TABLE … DROP COLUMN` is
 * enough (SQLite 3.35+). Old backups that still carry the column are handled
 * by the restore, which moves the value the same way.
 *
 * No loop over a collection, so no progress reporting.
 *
 * Migration ID: move-memory-maintenance-settings-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  sqliteColumnExists,
} from '../lib/database-utils';
import { legacyHousekeepingToMaintenance } from '@/lib/memory/settings-legacy';

export { legacyHousekeepingToMaintenance };

const MIGRATION_ID = 'move-memory-maintenance-settings-v1';
const SINGLE_USER_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const MAINTENANCE_KEY = 'memoryMaintenance';
const DEAD_INSTANCE_KEY = 'memoryExtractionConcurrency';
const DEAD_COLUMNS = ['autoHousekeepingSettings', 'memoryExtractionLimits', 'memoryExtractionConcurrency'] as const;

function deadColumnsPresent(): string[] {
  return DEAD_COLUMNS.filter(column => sqliteColumnExists('chat_settings', column));
}

export const moveMemoryMaintenanceSettingsMigration: Migration = {
  id: MIGRATION_ID,
  description:
    'Move chat_settings.autoHousekeepingSettings into instance_settings.memoryMaintenance and drop the dead memory knobs',
  introducedInVersion: '4.10.0',
  dependsOn: [
    'create-instance-settings-table-v1',
    'migrate-extraction-knobs-to-instance-settings-v1',
    'add-auto-housekeeping-settings-field-v1',
  ],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('instance_settings') || !sqliteTableExists('chat_settings')) return false;
    if (deadColumnsPresent().length > 0) return true;
    const db = getSQLiteDatabase();
    const dead = db.prepare('SELECT 1 FROM "instance_settings" WHERE "key" = ?').get(DEAD_INSTANCE_KEY);
    return !!dead;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    const context = 'migration.move-memory-maintenance-settings';

    try {
      const db = getSQLiteDatabase();
      let itemsAffected = 0;
      let copied = false;

      if (sqliteColumnExists('chat_settings', 'autoHousekeepingSettings')) {
        const row = (db
          .prepare('SELECT "autoHousekeepingSettings" AS value FROM "chat_settings" WHERE "userId" = ?')
          .get(SINGLE_USER_ID) ??
          db
            .prepare('SELECT "autoHousekeepingSettings" AS value FROM "chat_settings" ORDER BY "updatedAt" DESC LIMIT 1')
            .get()) as { value: unknown } | undefined;
        const maintenance = row ? legacyHousekeepingToMaintenance(row.value) : null;
        if (maintenance) {
          const result = db
            .prepare(
              `INSERT INTO "instance_settings" ("key", "value") VALUES (?, ?)
               ON CONFLICT("key") DO NOTHING`,
            )
            .run(MAINTENANCE_KEY, JSON.stringify(maintenance));
          copied = result.changes > 0;
          if (copied) itemsAffected++;
          logger.debug('Copied housekeeping settings into instance_settings.memoryMaintenance', {
            context,
            copied,
            enabled: maintenance.enabled,
            perCharacterCap: maintenance.perCharacterCap,
            overrides: Object.keys(maintenance.perCharacterCapOverrides).length,
          });
        }
      }

      const deadKey = db.prepare('DELETE FROM "instance_settings" WHERE "key" = ?').run(DEAD_INSTANCE_KEY);
      itemsAffected += deadKey.changes;

      const dropped: string[] = [];
      for (const column of deadColumnsPresent()) {
        db.exec(`ALTER TABLE "chat_settings" DROP COLUMN "${column}"`);
        dropped.push(column);
        itemsAffected++;
      }

      const durationMs = Date.now() - startTime;
      logger.info('Moved memory maintenance settings and dropped the dead memory knobs', {
        context,
        copied,
        droppedColumns: dropped,
        droppedInstanceKey: deadKey.changes > 0,
        durationMs,
      });

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected,
        message: `Moved memory maintenance settings${copied ? '' : ' (nothing to copy)'}; dropped ${dropped.length} column(s)`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to move memory maintenance settings', { context, error: errorMessage });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to move memory maintenance settings',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
