/**
 * Migration: Add defaultAvatarGenerationEnabled to Projects
 *
 * Adds a project-level default for avatar generation in new chats.
 *
 * Migration ID: add-project-avatar-generation-default-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addProjectAvatarGenerationDefaultMigration: Migration = {
  id: 'add-project-avatar-generation-default-v1',
  description: 'Add defaultAvatarGenerationEnabled field to projects table',
  introducedInVersion: '4.3.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('projects')) return false;
    const columns = getSQLiteTableColumns('projects');
    return !columns.some(col => col.name === 'defaultAvatarGenerationEnabled');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();
      const columns = getSQLiteTableColumns('projects');

      if (!columns.some(col => col.name === 'defaultAvatarGenerationEnabled')) {
        db.exec(`ALTER TABLE "projects" ADD COLUMN "defaultAvatarGenerationEnabled" INTEGER DEFAULT NULL`);
        columnsAdded++;
        logger.info('Added defaultAvatarGenerationEnabled column to projects table', {
          context: 'migration.add-project-avatar-generation-default',
        });
      }

      const durationMs = Date.now() - startTime;
      return {
        id: 'add-project-avatar-generation-default-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} column(s) to projects table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to add project avatar generation default', {
        context: 'migration.add-project-avatar-generation-default',
        error: errorMessage,
      });
      return {
        id: 'add-project-avatar-generation-default-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add project avatar generation default',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
