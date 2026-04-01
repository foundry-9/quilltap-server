/**
 * Migration: Add Agent Mode Fields
 *
 * This migration adds agent mode fields to multiple tables:
 * - chat_settings: agentModeSettings (JSON string with maxTurns, defaultEnabled)
 * - characters: defaultAgentModeEnabled (INTEGER, nullable)
 * - projects: defaultAgentModeEnabled (INTEGER, nullable)
 * - chats: agentModeEnabled (INTEGER, nullable), agentTurnCount (INTEGER, default 0)
 *
 * Agent mode allows LLMs to iteratively use tools, verify results, and self-correct
 * before delivering a final response via the submit_final_response tool.
 *
 * Migration ID: add-agent-mode-fields-v1
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
 * Add Agent Mode Fields Migration
 */
export const addAgentModeFieldsMigration: Migration = {
  id: 'add-agent-mode-fields-v1',
  description: 'Add agent mode fields to chat_settings, characters, projects, and chats tables',
  introducedInVersion: '2.10.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    // Only run for SQLite backend
    if (!isSQLiteBackend()) {
      return false;
    }

    // Check if any of the target tables are missing the new columns
    const tablesToCheck = [
      { table: 'chat_settings', column: 'agentModeSettings' },
      { table: 'characters', column: 'defaultAgentModeEnabled' },
      { table: 'projects', column: 'defaultAgentModeEnabled' },
      { table: 'chats', column: 'agentModeEnabled' },
      { table: 'chats', column: 'agentTurnCount' },
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

      // Default agent mode settings as JSON
      const defaultAgentModeSettings = JSON.stringify({
        maxTurns: 10,
        defaultEnabled: false,
      });

      // Add agentModeSettings to chat_settings
      if (sqliteTableExists('chat_settings')) {
        const chatSettingsColumns = getSQLiteTableColumns('chat_settings');
        const chatSettingsColumnNames = chatSettingsColumns.map((col) => col.name);

        if (!chatSettingsColumnNames.includes('agentModeSettings')) {
          db.exec(
            `ALTER TABLE "chat_settings" ADD COLUMN "agentModeSettings" TEXT DEFAULT '${defaultAgentModeSettings}'`
          );
          columnsAdded++;
          logger.info('Added agentModeSettings column to chat_settings table', {
            context: 'migration.add-agent-mode-fields',
          });
        }
      }

      // Add defaultAgentModeEnabled to characters
      if (sqliteTableExists('characters')) {
        const characterColumns = getSQLiteTableColumns('characters');
        const characterColumnNames = characterColumns.map((col) => col.name);

        if (!characterColumnNames.includes('defaultAgentModeEnabled')) {
          // NULL = inherit from global, 0 = disabled, 1 = enabled
          db.exec(`ALTER TABLE "characters" ADD COLUMN "defaultAgentModeEnabled" INTEGER DEFAULT NULL`);
          columnsAdded++;
          logger.info('Added defaultAgentModeEnabled column to characters table', {
            context: 'migration.add-agent-mode-fields',
          });
        }
      }

      // Add defaultAgentModeEnabled to projects
      if (sqliteTableExists('projects')) {
        const projectColumns = getSQLiteTableColumns('projects');
        const projectColumnNames = projectColumns.map((col) => col.name);

        if (!projectColumnNames.includes('defaultAgentModeEnabled')) {
          // NULL = inherit from character or global, 0 = disabled, 1 = enabled
          db.exec(`ALTER TABLE "projects" ADD COLUMN "defaultAgentModeEnabled" INTEGER DEFAULT NULL`);
          columnsAdded++;
          logger.info('Added defaultAgentModeEnabled column to projects table', {
            context: 'migration.add-agent-mode-fields',
          });
        }
      }

      // Add agentModeEnabled and agentTurnCount to chats
      if (sqliteTableExists('chats')) {
        const chatColumns = getSQLiteTableColumns('chats');
        const chatColumnNames = chatColumns.map((col) => col.name);

        if (!chatColumnNames.includes('agentModeEnabled')) {
          // NULL = inherit from project/character/global, 0 = disabled, 1 = enabled
          db.exec(`ALTER TABLE "chats" ADD COLUMN "agentModeEnabled" INTEGER DEFAULT NULL`);
          columnsAdded++;
          logger.info('Added agentModeEnabled column to chats table', {
            context: 'migration.add-agent-mode-fields',
          });
        }

        if (!chatColumnNames.includes('agentTurnCount')) {
          // Track current agent turn count (resets on new user message)
          db.exec(`ALTER TABLE "chats" ADD COLUMN "agentTurnCount" INTEGER DEFAULT 0`);
          columnsAdded++;
          logger.info('Added agentTurnCount column to chats table', {
            context: 'migration.add-agent-mode-fields',
          });
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('Added agent mode fields to database tables', {
        context: 'migration.add-agent-mode-fields',
        columnsAdded,
        durationMs,
      });

      return {
        id: 'add-agent-mode-fields-v1',
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} agent mode column(s) to database tables`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add agent mode fields', {
        context: 'migration.add-agent-mode-fields',
        error: errorMessage,
      });

      return {
        id: 'add-agent-mode-fields-v1',
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add agent mode fields',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
