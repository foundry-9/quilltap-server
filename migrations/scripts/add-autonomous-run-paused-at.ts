/**
 * Migration: Add Autonomous Run Paused-At
 *
 * Adds a single nullable `runPausedAt` column to `chats`. It records the
 * instant a manual (or daily-cap) pause took effect on an autonomous-room run
 * so that, when the run is *resumed* (continued, not restarted), the time
 * spent paused can be excluded from the wall-clock budget — the resume path
 * shifts `runStartedAt` forward by the active (pre-pause) elapsed time.
 *
 * `chats` (nullable; existing rows unaffected):
 *  - runPausedAt TEXT
 *
 * Migration ID: add-autonomous-run-paused-at-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

interface ColumnSpec {
  name: string;
  ddl: string;
}

const CHATS_COLUMNS: ColumnSpec[] = [
  { name: 'runPausedAt', ddl: 'TEXT' },
];

export const addAutonomousRunPausedAtMigration: Migration = {
  id: 'add-autonomous-run-paused-at-v1',
  description: 'Add runPausedAt column to chats for resume-excludes-paused-time wall-clock accounting',
  introducedInVersion: '4.6.0',
  dependsOn: ['sqlite-initial-schema-v1', 'add-autonomous-rooms-fields-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chats')) {
      return false;
    }

    const chatColumnNames = getSQLiteTableColumns('chats').map((c) => c.name);
    return CHATS_COLUMNS.some((col) => !chatColumnNames.includes(col.name));
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      const chatColumnNames = new Set(getSQLiteTableColumns('chats').map((c) => c.name));
      for (const col of CHATS_COLUMNS) {
        if (!chatColumnNames.has(col.name)) {
          db.exec(`ALTER TABLE "chats" ADD COLUMN "${col.name}" ${col.ddl}`);
          columnsAdded++;
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('Added runPausedAt column to chats', {
        context: 'migration.add-autonomous-run-paused-at',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-autonomous-run-paused-at-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} column(s) to chats`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add runPausedAt column to chats', {
        context: 'migration.add-autonomous-run-paused-at',
        error: errorMessage,
      });

      return {
        id: 'add-autonomous-run-paused-at-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add runPausedAt column to chats',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
