/**
 * Migration: Add spokenThisCycleParticipantIds Field to Chats
 *
 * Adds a TEXT column on `chats` holding a JSON-encoded array of participantIds
 * that have spoken so far in the current turn rotation cycle. Used by the turn
 * manager to honor the "everyone speaks at least once per cycle" guarantee
 * across both LLM-controlled and user-controlled characters. Defaults to '[]'
 * for existing rows so any in-flight cycles effectively restart on the next
 * message (the previous turn-state was derived from message history anyway).
 *
 * Migration ID: add-spoken-this-cycle-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addSpokenThisCycleFieldMigration: Migration = {
  id: 'add-spoken-this-cycle-field-v1',
  description: 'Add spokenThisCycleParticipantIds field to chats table for cross-cycle turn tracking',
  introducedInVersion: '4.6.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chats')) {
      return false;
    }

    const columns = getSQLiteTableColumns('chats');
    const columnNames = columns.map((col) => col.name);

    return !columnNames.includes('spokenThisCycleParticipantIds');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      const columns = getSQLiteTableColumns('chats');
      const columnNames = columns.map((col) => col.name);

      if (!columnNames.includes('spokenThisCycleParticipantIds')) {
        db.exec(`ALTER TABLE "chats" ADD COLUMN "spokenThisCycleParticipantIds" TEXT DEFAULT '[]'`);
        columnsAdded++;
        logger.info('Added spokenThisCycleParticipantIds column to chats table', {
          context: 'migration.add-spoken-this-cycle-field',
        });
      }

      const durationMs = Date.now() - startTime;

      return {
        id: 'add-spoken-this-cycle-field-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added spokenThisCycleParticipantIds column to chats table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add spokenThisCycleParticipantIds column', {
        context: 'migration.add-spoken-this-cycle-field',
        error: errorMessage,
      });

      return {
        id: 'add-spoken-this-cycle-field-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add spokenThisCycleParticipantIds column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
