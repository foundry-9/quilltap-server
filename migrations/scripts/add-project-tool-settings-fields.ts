/**
 * Migration: Add Tool Settings Fields to Projects
 *
 * This migration adds the default tool settings fields to the projects table:
 * - defaultDisabledTools: JSON array of individually disabled tool IDs
 * - defaultDisabledToolGroups: JSON array of disabled group patterns
 *
 * These defaults are applied to new chats created within the project.
 *
 * Migration ID: add-project-tool-settings-fields-v1
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
 * Add Project Tool Settings Fields Migration
 */
export const addProjectToolSettingsFieldsMigration: Migration = {
  id: 'add-project-tool-settings-fields-v1',
  description: 'Add default tool settings fields (defaultDisabledTools, defaultDisabledToolGroups) to projects table',
  introducedInVersion: '2.8.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    // Only run for SQLite backend
    if (!isSQLiteBackend()) {
      return false;
    }

    // Check if projects table exists
    if (!sqliteTableExists('projects')) {
      return false;
    }

    // Check if any of the columns already exist
    const columns = getSQLiteTableColumns('projects');
    const columnNames = columns.map((col) => col.name);

    const hasDefaultDisabledTools = columnNames.includes('defaultDisabledTools');
    const hasDefaultDisabledToolGroups = columnNames.includes('defaultDisabledToolGroups');

    // Run if any column is missing
    if (!hasDefaultDisabledTools || !hasDefaultDisabledToolGroups) {
      return true;
    }

    return false;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();
      const columns = getSQLiteTableColumns('projects');
      const columnNames = columns.map((col) => col.name);

      // Add defaultDisabledTools column if missing
      if (!columnNames.includes('defaultDisabledTools')) {
        db.exec(`ALTER TABLE "projects" ADD COLUMN "defaultDisabledTools" TEXT DEFAULT '[]'`);
        columnsAdded++;
        logger.info('Added defaultDisabledTools column to projects table', {
          context: 'migration.add-project-tool-settings-fields',
        });
      }

      // Add defaultDisabledToolGroups column if missing
      if (!columnNames.includes('defaultDisabledToolGroups')) {
        db.exec(`ALTER TABLE "projects" ADD COLUMN "defaultDisabledToolGroups" TEXT DEFAULT '[]'`);
        columnsAdded++;
        logger.info('Added defaultDisabledToolGroups column to projects table', {
          context: 'migration.add-project-tool-settings-fields',
        });
      }

      const durationMs = Date.now() - startTime;

      logger.info('Added project tool settings columns to projects table', {
        context: 'migration.add-project-tool-settings-fields',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-project-tool-settings-fields-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} project tool settings column(s) to projects table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add project tool settings columns', {
        context: 'migration.add-project-tool-settings-fields',
        error: errorMessage,
      });

      return {
        id: 'add-project-tool-settings-fields-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add project tool settings columns',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
