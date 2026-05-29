/**
 * Migration: Add Autonomous Run Paused-Accumulator
 *
 * Adds a single `runPausedAccumMs` column to `chats` — the cumulative number
 * of milliseconds a run has spent paused, across however many pause/resume
 * cycles (and crash-interruption reconciles) it has been through.
 *
 * This exists so the wall-clock budget can exclude paused time WITHOUT
 * shifting `runStartedAt`. `runStartedAt` does double duty as the token-
 * accounting window start (the turn handler sums `llm_logs` since that
 * instant), so moving it forward to "subtract" paused time also dropped every
 * pre-pause token from the count. Instead we leave `runStartedAt` fixed and
 * have the wall-clock check compute `(now - runStartedAt) - runPausedAccumMs`.
 *
 * `chats` (default 0; existing rows unaffected):
 *  - runPausedAccumMs INTEGER DEFAULT 0
 *
 * Migration ID: add-autonomous-run-paused-accum-v1
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
  { name: 'runPausedAccumMs', ddl: 'INTEGER DEFAULT 0' },
];

export const addAutonomousRunPausedAccumMigration: Migration = {
  id: 'add-autonomous-run-paused-accum-v1',
  description: 'Add runPausedAccumMs column to chats so wall-clock budget can exclude paused time without shifting runStartedAt',
  introducedInVersion: '4.6.0',
  dependsOn: ['sqlite-initial-schema-v1', 'add-autonomous-run-paused-at-v1'],

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

      logger.info('Added runPausedAccumMs column to chats', {
        context: 'migration.add-autonomous-run-paused-accum',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-autonomous-run-paused-accum-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} column(s) to chats`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add runPausedAccumMs column to chats', {
        context: 'migration.add-autonomous-run-paused-accum',
        error: errorMessage,
      });

      return {
        id: 'add-autonomous-run-paused-accum-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add runPausedAccumMs column to chats',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
