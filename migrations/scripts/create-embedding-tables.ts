/**
 * Migration: Create Embedding Tables
 *
 * Creates the tfidf_vocabularies and embedding_status tables for the
 * built-in TF-IDF embedding provider and embedding job tracking.
 *
 * - tfidf_vocabularies: Stores vocabulary, IDF weights, avgDocLength per profile
 * - embedding_status: Tracks embedding status per embeddable entity (memory, etc.)
 *
 * This migration runs for existing SQLite installations to add the new tables.
 * New installations get these tables from sqlite-initial-schema.
 *
 * Migration ID: create-embedding-tables-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';

/**
 * Create Embedding Tables Migration
 */
export const createEmbeddingTablesMigration: Migration = {
  id: 'create-embedding-tables-v1',
  description: 'Create tfidf_vocabularies and embedding_status tables for built-in embedding provider',
  introducedInVersion: '2.9.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    // Only run for SQLite backend
    if (!isSQLiteBackend()) {
      return false;
    }

    // Check if either table is missing
    const tfidfExists = sqliteTableExists('tfidf_vocabularies');
    const statusExists = sqliteTableExists('embedding_status');

    return !tfidfExists || !statusExists;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let tablesCreated = 0;
    let indexesCreated = 0;

    try {
      const db = getSQLiteDatabase();

      // Create tables in a transaction
      const createTables = db.transaction(() => {
        // Create tfidf_vocabularies table
        if (!sqliteTableExists('tfidf_vocabularies')) {
          db.exec(`CREATE TABLE IF NOT EXISTS "tfidf_vocabularies" (
            "id" TEXT PRIMARY KEY,
            "profileId" TEXT NOT NULL UNIQUE,
            "userId" TEXT NOT NULL,
            "vocabulary" TEXT NOT NULL,
            "idf" TEXT NOT NULL,
            "avgDocLength" REAL NOT NULL,
            "vocabularySize" INTEGER NOT NULL,
            "includeBigrams" INTEGER DEFAULT 1,
            "fittedAt" TEXT NOT NULL,
            "createdAt" TEXT NOT NULL,
            "updatedAt" TEXT NOT NULL,
            FOREIGN KEY ("profileId") REFERENCES "embedding_profiles"("id") ON DELETE CASCADE
          )`);
          tablesCreated++;

          // Create indexes
          db.exec(`CREATE INDEX IF NOT EXISTS "idx_tfidf_vocabularies_userId" ON "tfidf_vocabularies" ("userId")`);
          db.exec(`CREATE INDEX IF NOT EXISTS "idx_tfidf_vocabularies_profileId" ON "tfidf_vocabularies" ("profileId")`);
          indexesCreated += 2;

          logger.info('Created tfidf_vocabularies table', {
            context: 'migration.create-embedding-tables',
          });
        }

        // Create embedding_status table
        if (!sqliteTableExists('embedding_status')) {
          db.exec(`CREATE TABLE IF NOT EXISTS "embedding_status" (
            "id" TEXT PRIMARY KEY,
            "userId" TEXT NOT NULL,
            "entityType" TEXT NOT NULL,
            "entityId" TEXT NOT NULL,
            "profileId" TEXT NOT NULL,
            "status" TEXT DEFAULT 'PENDING',
            "embeddedAt" TEXT,
            "error" TEXT,
            "createdAt" TEXT NOT NULL,
            "updatedAt" TEXT NOT NULL,
            UNIQUE("entityType", "entityId", "profileId")
          )`);
          tablesCreated++;

          // Create indexes
          db.exec(`CREATE INDEX IF NOT EXISTS "idx_embedding_status_userId" ON "embedding_status" ("userId")`);
          db.exec(`CREATE INDEX IF NOT EXISTS "idx_embedding_status_status" ON "embedding_status" ("status")`);
          db.exec(`CREATE INDEX IF NOT EXISTS "idx_embedding_status_entityType_entityId" ON "embedding_status" ("entityType", "entityId")`);
          indexesCreated += 3;

          logger.info('Created embedding_status table', {
            context: 'migration.create-embedding-tables',
          });
        }
      });

      createTables();

      const durationMs = Date.now() - startTime;

      logger.info('Embedding tables migration completed', {
        context: 'migration.create-embedding-tables',
        tablesCreated,
        indexesCreated,
        durationMs,
      });

      return {
        id: 'create-embedding-tables-v1',
        success: true,
        itemsAffected: tablesCreated + indexesCreated,
        message: `Created ${tablesCreated} tables and ${indexesCreated} indexes`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Embedding tables migration failed', {
        context: 'migration.create-embedding-tables',
        error: errorMessage,
      });

      return {
        id: 'create-embedding-tables-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to create embedding tables',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
