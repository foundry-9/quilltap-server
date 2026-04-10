/**
 * Migration: Add Pending Outfit Notifications Field
 *
 * Adds a pendingOutfitNotifications field to the chats table for
 * storing outfit change notifications that should be delivered to
 * characters on their next turn.
 *
 * Migration ID: add-pending-outfit-notifications-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

/**
 * Add Pending Outfit Notifications Field Migration
 */
export const addPendingOutfitNotificationsFieldMigration: Migration = {
  id: 'add-pending-outfit-notifications-field-v1',
  description: 'Add pendingOutfitNotifications field to chats table',
  introducedInVersion: '4.2.0',
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

    return !columnNames.includes('pendingOutfitNotifications');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      if (sqliteTableExists('chats')) {
        const columns = getSQLiteTableColumns('chats');
        const columnNames = columns.map((col) => col.name);

        if (!columnNames.includes('pendingOutfitNotifications')) {
          db.exec(`ALTER TABLE "chats" ADD COLUMN "pendingOutfitNotifications" TEXT DEFAULT NULL`);
          columnsAdded++;
          logger.info('Added pendingOutfitNotifications column to chats table', {
            context: 'migration.add-pending-outfit-notifications-field',
          });
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('Pending outfit notifications field migration completed', {
        context: 'migration.add-pending-outfit-notifications-field',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-pending-outfit-notifications-field-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} column(s) to chats table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add pending outfit notifications field', {
        context: 'migration.add-pending-outfit-notifications-field',
        error: errorMessage,
      });

      return {
        id: 'add-pending-outfit-notifications-field-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add pending outfit notifications field',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
