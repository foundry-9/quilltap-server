/**
 * Migration: Add Terminal Session Geometry Columns
 *
 * Adds `terminal_sessions.cols` and `terminal_sessions.rows` (INTEGER, default
 * NULL): the terminal's size at spawn, updated to its final value on exit.
 * `terminal_read` replays an exited session's transcript through a terminal
 * emulator at this size (bug 255). No backfill: older sessions read back at
 * 80×24.
 *
 * Migration ID: add-terminal-session-geometry-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
} from '../lib/database-utils';

const MIGRATION_ID = 'add-terminal-session-geometry-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;

export const addTerminalSessionGeometryMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Add cols and rows to terminal_sessions (geometry for transcript replay)',
  introducedInVersion: '4.11.0',
  dependsOn: ['add-terminal-sessions-table-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('terminal_sessions')) return false;
    return (
      !sqliteColumnExists('terminal_sessions', 'cols') ||
      !sqliteColumnExists('terminal_sessions', 'rows')
    );
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    try {
      const addedCols = addColumnIfMissing('terminal_sessions', 'cols', 'INTEGER DEFAULT NULL');
      const addedRows = addColumnIfMissing('terminal_sessions', 'rows', 'INTEGER DEFAULT NULL');
      const added = (addedCols ? 1 : 0) + (addedRows ? 1 : 0);
      if (added > 0) {
        logger.info('Added geometry columns to terminal_sessions', { context: LOG_CONTEXT, added });
      }
      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: added,
        message: 'Added cols and rows columns to terminal_sessions',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to add geometry columns to terminal_sessions', {
        context: LOG_CONTEXT,
        error: errorMessage,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to add geometry columns to terminal_sessions',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
