/**
 * Migration: Create Help Docs Table
 *
 * Creates the help_docs table for runtime-embedded help documentation.
 *
 * - help_docs: Stores help documentation content with embeddings for semantic search
 *
 * This migration runs for existing SQLite installations to add the new table.
 * New installations get this table from sqlite-initial-schema.
 *
 * Migration ID: create-help-docs-table-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';

/**
 * Create Help Docs Table Migration
 */
export const createHelpDocsTableMigration: Migration = {
  id: 'create-help-docs-table-v1',
  description: 'Create help_docs table for runtime-embedded help documentation',
  introducedInVersion: '2.15.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    // Only run for SQLite backend
    if (!isSQLiteBackend()) {
      return false;
    }

    // Check if table is missing
    const helpDocsExists = sqliteTableExists('help_docs');

    return !helpDocsExists;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let tablesCreated = 0;
    let indexesCreated = 0;

    try {
      const db = getSQLiteDatabase();

      // Create table in a transaction
      const createTables = db.transaction(() => {
        // Create help_docs table
        if (!sqliteTableExists('help_docs')) {
          db.exec(`CREATE TABLE IF NOT EXISTS "help_docs" (
            "id" TEXT PRIMARY KEY,
            "title" TEXT NOT NULL,
            "path" TEXT NOT NULL UNIQUE,
            "url" TEXT NOT NULL DEFAULT '',
            "content" TEXT NOT NULL,
            "contentHash" TEXT NOT NULL,
            "embedding" BLOB,
            "createdAt" TEXT NOT NULL,
            "updatedAt" TEXT NOT NULL
          )`);
          tablesCreated++;

          // Create indexes
          db.exec(`CREATE INDEX IF NOT EXISTS "idx_help_docs_path" ON "help_docs" ("path")`);
          db.exec(`CREATE INDEX IF NOT EXISTS "idx_help_docs_url" ON "help_docs" ("url")`);
          indexesCreated += 2;

          logger.info('Created help_docs table', {
            context: 'migration.create-help-docs-table',
          });
        }
      });

      createTables();

      const durationMs = Date.now() - startTime;

      logger.info('Help docs table migration completed', {
        context: 'migration.create-help-docs-table',
        tablesCreated,
        indexesCreated,
        durationMs,
      });

      return {
        id: 'create-help-docs-table-v1',
        success: true,
        itemsAffected: tablesCreated + indexesCreated,
        message: `Created ${tablesCreated} tables and ${indexesCreated} indexes`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Help docs table migration failed', {
        context: 'migration.create-help-docs-table',
        error: errorMessage,
      });

      return {
        id: 'create-help-docs-table-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to create help_docs table',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
