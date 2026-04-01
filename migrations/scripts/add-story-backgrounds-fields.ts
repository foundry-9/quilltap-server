/**
 * Migration: Add Story Backgrounds Fields
 *
 * This migration adds story background fields to multiple tables:
 * - chat_settings: storyBackgroundsSettings (JSON string with enabled, defaultImageProfileId)
 * - chats: storyBackgroundImageId (TEXT, nullable), lastBackgroundGeneratedAt (TEXT, nullable)
 * - projects: storyBackgroundsEnabled (INTEGER, nullable), staticBackgroundImageId (TEXT, nullable),
 *             storyBackgroundImageId (TEXT, nullable), backgroundDisplayMode (TEXT, default 'theme')
 *
 * Story backgrounds allow AI-generated dynamic background images for chats and projects
 * that reflect the story content and characters.
 *
 * Migration ID: add-story-backgrounds-fields-v1
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
 * Add Story Backgrounds Fields Migration
 */
export const addStoryBackgroundsFieldsMigration: Migration = {
  id: 'add-story-backgrounds-fields-v1',
  description: 'Add story backgrounds fields to chat_settings, chats, and projects tables',
  introducedInVersion: '2.11.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    // Only run for SQLite backend
    if (!isSQLiteBackend()) {
      return false;
    }

    // Check if any of the target tables are missing the new columns
    const tablesToCheck = [
      { table: 'chat_settings', column: 'storyBackgroundsSettings' },
      { table: 'chats', column: 'storyBackgroundImageId' },
      { table: 'chats', column: 'lastBackgroundGeneratedAt' },
      { table: 'projects', column: 'storyBackgroundsEnabled' },
      { table: 'projects', column: 'staticBackgroundImageId' },
      { table: 'projects', column: 'storyBackgroundImageId' },
      { table: 'projects', column: 'backgroundDisplayMode' },
    ];

    for (const { table, column } of tablesToCheck) {
      if (!sqliteTableExists(table)) {
        continue;
      }

      const columns = getSQLiteTableColumns(table);
      const columnNames = columns.map((col) => col.name);

      if (!columnNames.includes(column)) {
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

      // Default story backgrounds settings as JSON
      const defaultStoryBackgroundsSettings = JSON.stringify({
        enabled: false,
        defaultImageProfileId: null,
      });

      // Add storyBackgroundsSettings to chat_settings
      if (sqliteTableExists('chat_settings')) {
        const chatSettingsColumns = getSQLiteTableColumns('chat_settings');
        const chatSettingsColumnNames = chatSettingsColumns.map((col) => col.name);

        if (!chatSettingsColumnNames.includes('storyBackgroundsSettings')) {
          db.exec(
            `ALTER TABLE "chat_settings" ADD COLUMN "storyBackgroundsSettings" TEXT DEFAULT '${defaultStoryBackgroundsSettings}'`
          );
          columnsAdded++;
          logger.info('Added storyBackgroundsSettings column to chat_settings table', {
            context: 'migration.add-story-backgrounds-fields',
          });
        }
      }

      // Add storyBackgroundImageId and lastBackgroundGeneratedAt to chats
      if (sqliteTableExists('chats')) {
        const chatColumns = getSQLiteTableColumns('chats');
        const chatColumnNames = chatColumns.map((col) => col.name);

        if (!chatColumnNames.includes('storyBackgroundImageId')) {
          db.exec(`ALTER TABLE "chats" ADD COLUMN "storyBackgroundImageId" TEXT DEFAULT NULL`);
          columnsAdded++;
          logger.info('Added storyBackgroundImageId column to chats table', {
            context: 'migration.add-story-backgrounds-fields',
          });
        }

        if (!chatColumnNames.includes('lastBackgroundGeneratedAt')) {
          db.exec(`ALTER TABLE "chats" ADD COLUMN "lastBackgroundGeneratedAt" TEXT DEFAULT NULL`);
          columnsAdded++;
          logger.info('Added lastBackgroundGeneratedAt column to chats table', {
            context: 'migration.add-story-backgrounds-fields',
          });
        }
      }

      // Add story backgrounds fields to projects
      if (sqliteTableExists('projects')) {
        const projectColumns = getSQLiteTableColumns('projects');
        const projectColumnNames = projectColumns.map((col) => col.name);

        if (!projectColumnNames.includes('storyBackgroundsEnabled')) {
          // NULL = inherit from global, 0 = disabled, 1 = enabled
          db.exec(`ALTER TABLE "projects" ADD COLUMN "storyBackgroundsEnabled" INTEGER DEFAULT NULL`);
          columnsAdded++;
          logger.info('Added storyBackgroundsEnabled column to projects table', {
            context: 'migration.add-story-backgrounds-fields',
          });
        }

        if (!projectColumnNames.includes('staticBackgroundImageId')) {
          db.exec(`ALTER TABLE "projects" ADD COLUMN "staticBackgroundImageId" TEXT DEFAULT NULL`);
          columnsAdded++;
          logger.info('Added staticBackgroundImageId column to projects table', {
            context: 'migration.add-story-backgrounds-fields',
          });
        }

        if (!projectColumnNames.includes('storyBackgroundImageId')) {
          db.exec(`ALTER TABLE "projects" ADD COLUMN "storyBackgroundImageId" TEXT DEFAULT NULL`);
          columnsAdded++;
          logger.info('Added storyBackgroundImageId column to projects table', {
            context: 'migration.add-story-backgrounds-fields',
          });
        }

        if (!projectColumnNames.includes('backgroundDisplayMode')) {
          db.exec(`ALTER TABLE "projects" ADD COLUMN "backgroundDisplayMode" TEXT DEFAULT 'theme'`);
          columnsAdded++;
          logger.info('Added backgroundDisplayMode column to projects table', {
            context: 'migration.add-story-backgrounds-fields',
          });
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('Added story backgrounds fields to database tables', {
        context: 'migration.add-story-backgrounds-fields',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-story-backgrounds-fields-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} story backgrounds column(s) to database tables`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add story backgrounds fields', {
        context: 'migration.add-story-backgrounds-fields',
        error: errorMessage,
      });

      return {
        id: 'add-story-backgrounds-fields-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add story backgrounds fields',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
