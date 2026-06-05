/**
 * Migration: Add Autonomous Rooms Fields
 *
 * Adds the schema substrate for 4.6 Private Character Rooms — bounded chats
 * whose participants are LLM-backed characters with no human composer in the
 * room. Persistence reuses the `chats` table; the new chat type is signaled
 * via the existing `chatType` column (extended elsewhere to include
 * `'autonomous'`). Per-room settings live on `chat_settings` as a JSON column.
 * Memory attribution gains a `witnessedContext` field on `memories`.
 *
 * `chats` (all nullable; existing rows unaffected):
 *  - budgetMaxTurns INTEGER
 *  - budgetMaxTokens INTEGER
 *  - budgetMaxWallClockMs INTEGER
 *  - budgetEstimatedSpendCapUSD REAL
 *  - scheduleCron TEXT
 *  - scheduleFreshnessWindowMs INTEGER
 *  - scheduleNextRunAt TEXT
 *  - scheduleLastRunAt TEXT
 *  - runState TEXT
 *  - currentRunId TEXT
 *  - runStateMessage TEXT
 *  - runStartedAt TEXT
 *  - runEndedAt TEXT
 *  - runTurnsConsumed INTEGER
 *  - runTokensConsumed INTEGER
 *  - runDestructiveToolsAllowed INTEGER DEFAULT 0
 *  - runVisibility TEXT
 *
 * Partial indexes on `chats`:
 *  - idx_chats_autonomous_nextRunAt (WHERE chatType = 'autonomous')
 *  - idx_chats_autonomous_runState  (WHERE chatType = 'autonomous')
 *
 * `chat_settings`:
 *  - autonomousRoomSettings TEXT DEFAULT '{}'
 *
 * `memories`:
 *  - witnessedContext TEXT (NULL on legacy rows; written by the extractor
 *    going forward as 'user_present' | 'autonomous_room' | 'manual')
 *
 * Migration ID: add-autonomous-rooms-fields-v1
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
  { name: 'budgetMaxTurns', ddl: 'INTEGER' },
  { name: 'budgetMaxTokens', ddl: 'INTEGER' },
  { name: 'budgetMaxWallClockMs', ddl: 'INTEGER' },
  { name: 'budgetEstimatedSpendCapUSD', ddl: 'REAL' },
  { name: 'scheduleCron', ddl: 'TEXT' },
  { name: 'scheduleFreshnessWindowMs', ddl: 'INTEGER' },
  { name: 'scheduleNextRunAt', ddl: 'TEXT' },
  { name: 'scheduleLastRunAt', ddl: 'TEXT' },
  { name: 'runState', ddl: 'TEXT' },
  { name: 'currentRunId', ddl: 'TEXT' },
  { name: 'runStateMessage', ddl: 'TEXT' },
  { name: 'runStartedAt', ddl: 'TEXT' },
  { name: 'runEndedAt', ddl: 'TEXT' },
  { name: 'runTurnsConsumed', ddl: 'INTEGER' },
  { name: 'runTokensConsumed', ddl: 'INTEGER' },
  { name: 'runDestructiveToolsAllowed', ddl: 'INTEGER DEFAULT 0' },
  { name: 'runVisibility', ddl: 'TEXT' },
];

const CHAT_SETTINGS_COLUMNS: ColumnSpec[] = [
  { name: 'autonomousRoomSettings', ddl: "TEXT DEFAULT '{}'" },
];

const MEMORIES_COLUMNS: ColumnSpec[] = [
  { name: 'witnessedContext', ddl: 'TEXT' },
];

export const addAutonomousRoomsFieldsMigration: Migration = {
  id: 'add-autonomous-rooms-fields-v1',
  description: 'Add autonomous-room columns to chats, autonomousRoomSettings to chat_settings, and witnessedContext to memories',
  introducedInVersion: '4.6.0',
  dependsOn: ['sqlite-initial-schema-v1', 'add-chat-type-field-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chats')) {
      return false;
    }

    const chatColumnNames = getSQLiteTableColumns('chats').map((c) => c.name);
    if (CHATS_COLUMNS.some((col) => !chatColumnNames.includes(col.name))) {
      return true;
    }

    if (sqliteTableExists('chat_settings')) {
      const settingsColumnNames = getSQLiteTableColumns('chat_settings').map((c) => c.name);
      if (CHAT_SETTINGS_COLUMNS.some((col) => !settingsColumnNames.includes(col.name))) {
        return true;
      }
    }

    if (sqliteTableExists('memories')) {
      const memoryColumnNames = getSQLiteTableColumns('memories').map((c) => c.name);
      if (MEMORIES_COLUMNS.some((col) => !memoryColumnNames.includes(col.name))) {
        return true;
      }
    }

    return false;
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

      db.exec(`CREATE INDEX IF NOT EXISTS idx_chats_autonomous_nextRunAt ON chats(scheduleNextRunAt) WHERE chatType = 'autonomous'`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_chats_autonomous_runState ON chats(runState) WHERE chatType = 'autonomous'`);

      if (sqliteTableExists('chat_settings')) {
        const settingsColumnNames = new Set(getSQLiteTableColumns('chat_settings').map((c) => c.name));
        for (const col of CHAT_SETTINGS_COLUMNS) {
          if (!settingsColumnNames.has(col.name)) {
            db.exec(`ALTER TABLE "chat_settings" ADD COLUMN "${col.name}" ${col.ddl}`);
            columnsAdded++;
          }
        }
      }

      if (sqliteTableExists('memories')) {
        const memoryColumnNames = new Set(getSQLiteTableColumns('memories').map((c) => c.name));
        for (const col of MEMORIES_COLUMNS) {
          if (!memoryColumnNames.has(col.name)) {
            db.exec(`ALTER TABLE "memories" ADD COLUMN "${col.name}" ${col.ddl}`);
            columnsAdded++;
          }
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('Added autonomous-room columns', {
        context: 'migration.add-autonomous-rooms-fields',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-autonomous-rooms-fields-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} autonomous-room column(s) across chats / chat_settings / memories`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add autonomous-room columns', {
        context: 'migration.add-autonomous-rooms-fields',
        error: errorMessage,
      });

      return {
        id: 'add-autonomous-rooms-fields-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add autonomous-room columns',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
