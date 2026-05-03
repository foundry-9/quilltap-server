/**
 * Migration: Move Memory Extraction Knobs to instance_settings
 *
 * The `memoryExtractionConcurrency` and `memoryExtractionLimits` columns
 * lived on `chat_settings` originally — but both knobs are properties of
 * the single background processor that this server instance runs, not of
 * any individual user. On databases that accumulated orphan chat_settings
 * rows from old test users, picking the "right" row at startup was
 * brittle (the seed grabbed the first row by sort order, which was almost
 * never the active user's row).
 *
 * This migration copies the active user's values across to the
 * `instance_settings` key/value table — the canonical home for
 * application-wide knobs. The chat_settings columns stay on disk but are
 * no longer read by any runtime code (a later cleanup migration may drop
 * them; SQLite ALTER DROP COLUMN is fragile, so we leave them for now).
 *
 * Idempotent: skips keys that are already populated in instance_settings.
 *
 * Migration ID: migrate-extraction-knobs-to-instance-settings-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

const SINGLE_USER_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

export const migrateExtractionKnobsToInstanceSettingsMigration: Migration = {
  id: 'migrate-extraction-knobs-to-instance-settings-v1',
  description:
    'Copy memoryExtractionConcurrency + memoryExtractionLimits from chat_settings into instance_settings',
  introducedInVersion: '4.4.0',
  dependsOn: ['create-instance-settings-table-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('instance_settings')) {
      return false;
    }

    if (!sqliteTableExists('chat_settings')) {
      return false;
    }

    const db = getSQLiteDatabase();
    const existing = db
      .prepare(
        `SELECT "key" FROM "instance_settings" WHERE "key" IN ('memoryExtractionConcurrency', 'memoryExtractionLimits')`,
      )
      .all() as Array<{ key: string }>;
    if (existing.length >= 2) {
      // Both already migrated — nothing to do.
      return false;
    }

    return true;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();
      const columns = getSQLiteTableColumns('chat_settings').map((c) => c.name);

      const projection = ['userId'];
      if (columns.includes('memoryExtractionConcurrency')) {
        projection.push('memoryExtractionConcurrency');
      }
      if (columns.includes('memoryExtractionLimits')) {
        projection.push('memoryExtractionLimits');
      }

      const rows = db
        .prepare(
          `SELECT ${projection.map((c) => `"${c}"`).join(', ')} FROM "chat_settings" WHERE "userId" = ?`,
        )
        .all(SINGLE_USER_ID) as Array<{
        userId: string;
        memoryExtractionConcurrency?: number | null;
        memoryExtractionLimits?: string | null;
      }>;

      const upsert = db.prepare(
        `INSERT INTO "instance_settings" ("key", "value") VALUES (?, ?)
         ON CONFLICT("key") DO NOTHING`,
      );

      let copied = 0;

      // memoryExtractionConcurrency — stored as a plain integer string
      const concurrencyRow = rows.find(
        (r) => typeof r.memoryExtractionConcurrency === 'number' && r.memoryExtractionConcurrency >= 1,
      );
      if (concurrencyRow?.memoryExtractionConcurrency) {
        const value = String(
          Math.max(1, Math.min(32, Math.floor(concurrencyRow.memoryExtractionConcurrency))),
        );
        const result = upsert.run('memoryExtractionConcurrency', value);
        if (result.changes > 0) {
          copied++;
          logger.info('Copied memoryExtractionConcurrency from chat_settings to instance_settings', {
            context: 'migration.migrate-extraction-knobs-to-instance-settings',
            value,
          });
        }
      }

      // memoryExtractionLimits — stored as a JSON string (already JSON-serialised in chat_settings)
      const limitsRow = rows.find(
        (r) => typeof r.memoryExtractionLimits === 'string' && r.memoryExtractionLimits.length > 0,
      );
      if (limitsRow?.memoryExtractionLimits) {
        // chat_settings stores it as JSON text; just copy verbatim. The
        // helper validates on read so a malformed value falls back cleanly.
        const result = upsert.run('memoryExtractionLimits', limitsRow.memoryExtractionLimits);
        if (result.changes > 0) {
          copied++;
          logger.info('Copied memoryExtractionLimits from chat_settings to instance_settings', {
            context: 'migration.migrate-extraction-knobs-to-instance-settings',
          });
        }
      }

      const durationMs = Date.now() - startTime;

      return {
        id: 'migrate-extraction-knobs-to-instance-settings-v1',
        success: true,
        itemsAffected: copied,
        message: `Migrated ${copied} extraction knob${copied === 1 ? '' : 's'} into instance_settings`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to migrate extraction knobs to instance_settings', {
        context: 'migration.migrate-extraction-knobs-to-instance-settings',
        error: errorMessage,
      });

      return {
        id: 'migrate-extraction-knobs-to-instance-settings-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to migrate extraction knobs to instance_settings',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
