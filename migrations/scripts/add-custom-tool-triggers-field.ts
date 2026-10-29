/**
 * Migration: Add customToolTriggers Field to Chat Settings
 *
 * This migration adds a customToolTriggers INTEGER field to the chat_settings
 * table. When enabled, a message from anyone in a chat that contains one of a
 * custom tool's declared `triggers` phrases runs that tool automatically with
 * its defaults. Off by default (0), and dead while `customTools` is off.
 *
 * Migration ID: add-custom-tool-triggers-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
} from '../lib/database-utils';

/**
 * Add customToolTriggers Field Migration
 */
export const addCustomToolTriggersFieldMigration: Migration = {
  id: 'add-custom-tool-triggers-field-v1',
  description: 'Add customToolTriggers field to chat_settings table for Pascal trigger phrases',
  introducedInVersion: '4.11.0',
  dependsOn: ['add-custom-tools-field-v1'],

  async shouldRun(): Promise<boolean> {
    // Only run for SQLite backend
    if (!isSQLiteBackend()) {
      return false;
    }

    // Check if chat_settings table exists
    if (!sqliteTableExists('chat_settings')) {
      return false;
    }

    // Check if customToolTriggers column already exists
    return !sqliteColumnExists('chat_settings', 'customToolTriggers');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      // Check and add customToolTriggers column.
      // SQLite uses INTEGER for boolean, 0 = false (default off)
      if (addColumnIfMissing('chat_settings', 'customToolTriggers', 'INTEGER DEFAULT 0')) {
        columnsAdded++;
        logger.info('Added customToolTriggers column to chat_settings table', {
          context: 'migration.add-custom-tool-triggers-field',
        });
      }

      const durationMs = Date.now() - startTime;

      logger.info('Added customToolTriggers column to chat_settings table', {
        context: 'migration.add-custom-tool-triggers-field',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-custom-tool-triggers-field-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added customToolTriggers column to chat_settings table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add customToolTriggers column', {
        context: 'migration.add-custom-tool-triggers-field',
        error: errorMessage,
      });

      return {
        id: 'add-custom-tool-triggers-field-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add customToolTriggers column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
