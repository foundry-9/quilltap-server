/**
 * Migration: Add Lantern image alert fields to projects and chats
 *
 * Adds the nullable boolean columns that back the "Announce Lantern Images
 * to Characters" setting:
 *   - projects.defaultAlertCharactersOfLanternImages (nullable, null = inherit)
 *   - chats.alertCharactersOfLanternImages (nullable, null = inherit from project)
 *
 * Migration ID: add-lantern-image-alert-fields-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addLanternImageAlertFieldsMigration: Migration = {
  id: 'add-lantern-image-alert-fields-v1',
  description: 'Add Lantern image announcement columns to projects and chats tables',
  introducedInVersion: '4.3.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;

    const needsProjects =
      sqliteTableExists('projects') &&
      !getSQLiteTableColumns('projects').some(
        (col) => col.name === 'defaultAlertCharactersOfLanternImages'
      );
    const needsChats =
      sqliteTableExists('chats') &&
      !getSQLiteTableColumns('chats').some(
        (col) => col.name === 'alertCharactersOfLanternImages'
      );

    return needsProjects || needsChats;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      if (sqliteTableExists('projects')) {
        const projectColumns = getSQLiteTableColumns('projects');
        if (!projectColumns.some((c) => c.name === 'defaultAlertCharactersOfLanternImages')) {
          db.exec(
            `ALTER TABLE "projects" ADD COLUMN "defaultAlertCharactersOfLanternImages" INTEGER DEFAULT NULL`
          );
          columnsAdded++;
          logger.info(
            'Added defaultAlertCharactersOfLanternImages column to projects table',
            { context: 'migration.add-lantern-image-alert-fields' }
          );
        }
      }

      if (sqliteTableExists('chats')) {
        const chatColumns = getSQLiteTableColumns('chats');
        if (!chatColumns.some((c) => c.name === 'alertCharactersOfLanternImages')) {
          db.exec(
            `ALTER TABLE "chats" ADD COLUMN "alertCharactersOfLanternImages" INTEGER DEFAULT NULL`
          );
          columnsAdded++;
          logger.info(
            'Added alertCharactersOfLanternImages column to chats table',
            { context: 'migration.add-lantern-image-alert-fields' }
          );
        }
      }

      const durationMs = Date.now() - startTime;
      return {
        id: 'add-lantern-image-alert-fields-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} column(s) for Lantern image announcements`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to add Lantern image alert fields', {
        context: 'migration.add-lantern-image-alert-fields',
        error: errorMessage,
      });
      return {
        id: 'add-lantern-image-alert-fields-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add Lantern image alert fields',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
