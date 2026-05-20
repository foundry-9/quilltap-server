/**
 * Migration: Add Terminal Sessions Table
 *
 * Creates the terminal_sessions table for in-chat terminal session management.
 * Stores session metadata including shell type, working directory, timestamps,
 * and optional transcript path for recorded sessions.
 *
 * Migration ID: add-terminal-sessions-table-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';

export const addTerminalSessionsTableMigration: Migration = {
  id: 'add-terminal-sessions-table-v1',
  description: 'Create terminal_sessions table for in-chat terminal session management',
  introducedInVersion: '4.5.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    return !sqliteTableExists('terminal_sessions');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      // Create terminal_sessions table
      db.exec(
        `CREATE TABLE IF NOT EXISTS "terminal_sessions" (
          "id" TEXT PRIMARY KEY,
          "chatId" TEXT NOT NULL,
          "label" TEXT,
          "shell" TEXT NOT NULL,
          "cwd" TEXT NOT NULL,
          "startedAt" TEXT NOT NULL,
          "exitedAt" TEXT,
          "exitCode" INTEGER,
          "transcriptPath" TEXT,
          "createdAt" TEXT NOT NULL,
          "updatedAt" TEXT NOT NULL,
          FOREIGN KEY ("chatId") REFERENCES "chats" ("id") ON DELETE CASCADE
        )`
      );

      // Create indexes
      db.exec(
        `CREATE INDEX IF NOT EXISTS "idx_terminal_sessions_chatId" ON "terminal_sessions" ("chatId")`
      );

      db.exec(
        `CREATE INDEX IF NOT EXISTS "idx_terminal_sessions_startedAt" ON "terminal_sessions" ("startedAt" DESC)`
      );

      logger.info('Created terminal_sessions table', {
        context: 'migration.add-terminal-sessions-table',
      });

      const durationMs = Date.now() - startTime;

      return {
        id: 'add-terminal-sessions-table-v1',
        success: true,
        itemsAffected: 1,
        message: 'Created terminal_sessions table',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to create terminal_sessions table', {
        context: 'migration.add-terminal-sessions-table',
        error: errorMessage,
      });

      return {
        id: 'add-terminal-sessions-table-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to create terminal_sessions table',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
