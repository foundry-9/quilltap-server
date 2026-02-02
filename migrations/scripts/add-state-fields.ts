/**
 * Migration: Add State Fields to Chats and Projects
 *
 * This migration adds a state TEXT field to both the chats and projects tables.
 * State is a JSON object that can store arbitrary key-value pairs for games,
 * inventory tracking, session data, and other persistent information.
 *
 * Migration ID: add-state-fields-v1
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
 * Add State Fields Migration
 */
export const addStateFieldsMigration: Migration = {
  id: 'add-state-fields-v1',
  description: 'Add state field to chats and projects tables for persistent JSON state storage',
  introducedInVersion: '2.8.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    // Only run for SQLite backend
    if (!isSQLiteBackend()) {
      return false;
    }

    // Check if chats table exists
    if (!sqliteTableExists('chats')) {
      return false;
    }

    // Check if projects table exists
    if (!sqliteTableExists('projects')) {
      return false;
    }

    // Check if state column already exists in chats
    const chatColumns = getSQLiteTableColumns('chats');
    const chatColumnNames = chatColumns.map((col) => col.name);
    const chatsHasState = chatColumnNames.includes('state');

    // Check if state column already exists in projects
    const projectColumns = getSQLiteTableColumns('projects');
    const projectColumnNames = projectColumns.map((col) => col.name);
    const projectsHasState = projectColumnNames.includes('state');

    // Run if either column is missing
    if (!chatsHasState || !projectsHasState) {
      return true;
    }

    return false;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;

    try {
      const db = getSQLiteDatabase();

      // Check and add state column to chats
      const chatColumns = getSQLiteTableColumns('chats');
      const chatColumnNames = chatColumns.map((col) => col.name);

      if (!chatColumnNames.includes('state')) {
        db.exec(`ALTER TABLE "chats" ADD COLUMN "state" TEXT DEFAULT '{}'`);
        columnsAdded++;
        logger.info('Added state column to chats table', {
          context: 'migration.add-state-fields',
        });
      }

      // Check and add state column to projects
      const projectColumns = getSQLiteTableColumns('projects');
      const projectColumnNames = projectColumns.map((col) => col.name);

      if (!projectColumnNames.includes('state')) {
        db.exec(`ALTER TABLE "projects" ADD COLUMN "state" TEXT DEFAULT '{}'`);
        columnsAdded++;
        logger.info('Added state column to projects table', {
          context: 'migration.add-state-fields',
        });
      }

      const durationMs = Date.now() - startTime;

      logger.info('Added state columns to chats and projects tables', {
        context: 'migration.add-state-fields',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-state-fields-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} state column(s) to chats and/or projects tables`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add state columns', {
        context: 'migration.add-state-fields',
        error: errorMessage,
      });

      return {
        id: 'add-state-fields-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add state columns',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
