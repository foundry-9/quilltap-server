/**
 * Migration: Add customToolIntervention Field to Chat Settings
 *
 * This migration adds a customToolIntervention INTEGER field to the
 * chat_settings table. When enabled (the default, 1), a Pascal custom tool
 * marked intervenable is held for the operator in a dialog before it is
 * announced; when off, every run goes ahead as rolled. Dead while
 * `customTools` is off.
 *
 * Migration ID: add-custom-tool-intervention-field-v1
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
 * Add customToolIntervention Field Migration
 */
export const addCustomToolInterventionFieldMigration: Migration = {
  id: 'add-custom-tool-intervention-field-v1',
  description: 'Add customToolIntervention field to chat_settings table for Pascal operator intervention',
  introducedInVersion: '4.11.0',
  dependsOn: ['add-custom-tool-triggers-field-v1'],

  async shouldRun(): Promise<boolean> {
    // Only run for SQLite backend
    if (!isSQLiteBackend()) {
      return false;
    }

    // Check if chat_settings table exists
    if (!sqliteTableExists('chat_settings')) {
      return false;
    }

    // Check if customToolIntervention column already exists
    return !sqliteColumnExists('chat_settings', 'customToolIntervention');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      // Check and add customToolIntervention column.
      // SQLite uses INTEGER for boolean, 1 = true (default on)
      if (addColumnIfMissing('chat_settings', 'customToolIntervention', 'INTEGER DEFAULT 1')) {
        columnsAdded++;
        logger.info('Added customToolIntervention column to chat_settings table', {
          context: 'migration.add-custom-tool-intervention-field',
        });
      }

      const durationMs = Date.now() - startTime;

      logger.info('Added customToolIntervention column to chat_settings table', {
        context: 'migration.add-custom-tool-intervention-field',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-custom-tool-intervention-field-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added customToolIntervention column to chat_settings table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add customToolIntervention column', {
        context: 'migration.add-custom-tool-intervention-field',
        error: errorMessage,
      });

      return {
        id: 'add-custom-tool-intervention-field-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add customToolIntervention column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
