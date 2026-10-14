/**
 * Migration: Add TF-IDF Text-Shape Version Column
 *
 * Adds `textShapeVersion` to `tfidf_vocabularies`: the version of the text a
 * Built-in (TF-IDF) vocabulary was fitted on, and its memories embedded with.
 * Version 1 is the canonical memory text with its anchor line left out
 * (`lexicalEmbeddingText`, builtin-tfidf-memory-tuning §2).
 *
 * Existing rows start at 0 — fitted with anchor lines — which the refit
 * policy reads as `text-shape` and refits once; the refit stamps the current
 * version. No backfill: whether a row is current is exactly what 0 says.
 *
 * Migration ID: add-tfidf-text-shape-version-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
} from '../lib/database-utils';

const MIGRATION_ID = 'add-tfidf-text-shape-version-v1';

export const addTfidfTextShapeVersionMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Add textShapeVersion column to tfidf_vocabularies',
  introducedInVersion: '4.10.0',
  dependsOn: ['sqlite-initial-schema-v1', 'create-embedding-tables-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('tfidf_vocabularies')) return false;
    return !sqliteColumnExists('tfidf_vocabularies', 'textShapeVersion');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    try {
      const added = addColumnIfMissing('tfidf_vocabularies', 'textShapeVersion', 'INTEGER DEFAULT 0');
      const durationMs = Date.now() - startTime;
      logger.info('Added textShapeVersion column to tfidf_vocabularies', {
        context: `migration.${MIGRATION_ID}`,
        durationMs,
      });
      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: added ? 1 : 0,
        message: 'Added textShapeVersion column to tfidf_vocabularies',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to add textShapeVersion column', {
        context: `migration.${MIGRATION_ID}`,
        error: errorMessage,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to add textShapeVersion column',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
