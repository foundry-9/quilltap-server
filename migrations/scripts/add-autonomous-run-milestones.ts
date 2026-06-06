/**
 * Migration: Add Autonomous-Room Pacing-Milestone Tracker
 *
 * Adds a single `runMilestonesAnnounced` column to `chats` — the per-run
 * bitmask recording which pacing nudges the Host has already posted for the
 * current/most-recent autonomous-room run.
 *
 *  - bit 0 (value 1): the halfway nudge has been announced
 *  - bit 1 (value 2): the near-end (10% remaining) nudge has been announced
 *
 * Reset to 0 at each run start by the turn handler, so a fresh run announces
 * its milestones again. Existing rows default to 0 (no milestone announced).
 *
 * `chats` (default 0; existing rows unaffected):
 *  - runMilestonesAnnounced INTEGER DEFAULT 0
 *
 * Migration ID: add-autonomous-run-milestones-v1
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
  { name: 'runMilestonesAnnounced', ddl: 'INTEGER DEFAULT 0' },
];

export const addAutonomousRunMilestonesMigration: Migration = {
  id: 'add-autonomous-run-milestones-v1',
  description: 'Add runMilestonesAnnounced column to chats so the Host announces each pacing milestone (halfway, near-end) at most once per autonomous-room run',
  introducedInVersion: '4.6.1',
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

      logger.info('Added runMilestonesAnnounced column to chats', {
        context: 'migration.add-autonomous-run-milestones',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-autonomous-run-milestones-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} column(s) to chats`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add runMilestonesAnnounced column to chats', {
        context: 'migration.add-autonomous-run-milestones',
        error: errorMessage,
      });

      return {
        id: 'add-autonomous-run-milestones-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add runMilestonesAnnounced column to chats',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
