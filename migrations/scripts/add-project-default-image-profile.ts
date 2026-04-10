/**
 * Migration: Add defaultImageProfileId to Projects
 *
 * Adds a project-level default image generation profile for new chats.
 * When a chat is created in a project with this set, it inherits the
 * project's image profile (unless overridden by the character or request).
 *
 * Migration ID: add-project-default-image-profile-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addProjectDefaultImageProfileMigration: Migration = {
  id: 'add-project-default-image-profile-v1',
  description: 'Add defaultImageProfileId field to projects table',
  introducedInVersion: '4.3.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('projects')) return false;
    const columns = getSQLiteTableColumns('projects');
    return !columns.some(col => col.name === 'defaultImageProfileId');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();
      const columns = getSQLiteTableColumns('projects');

      if (!columns.some(col => col.name === 'defaultImageProfileId')) {
        db.exec(`ALTER TABLE "projects" ADD COLUMN "defaultImageProfileId" TEXT DEFAULT NULL`);
        columnsAdded++;
        logger.info('Added defaultImageProfileId column to projects table', {
          context: 'migration.add-project-default-image-profile',
        });
      }

      const durationMs = Date.now() - startTime;
      return {
        id: 'add-project-default-image-profile-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} column(s) to projects table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to add project default image profile', {
        context: 'migration.add-project-default-image-profile',
        error: errorMessage,
      });
      return {
        id: 'add-project-default-image-profile-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add project default image profile',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
