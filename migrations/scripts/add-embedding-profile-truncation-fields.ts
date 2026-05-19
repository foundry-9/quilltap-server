/**
 * Migration: Add Matryoshka truncation fields to embedding profiles
 *
 * Adds two columns to `embedding_profiles`:
 *   - truncateToDimensions (INTEGER, nullable): if set, slice the provider's
 *     raw vector to this length before normalizing. Intended for Matryoshka-
 *     trained models like Qwen3-Embedding.
 *   - normalizeL2 (INTEGER, default 1): whether to L2-normalize the stored
 *     vector. Mirrors the boolean-as-INTEGER convention used elsewhere.
 *
 * Migration ID: add-embedding-profile-truncation-fields-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addEmbeddingProfileTruncationFieldsMigration: Migration = {
  id: 'add-embedding-profile-truncation-fields-v1',
  description: 'Add truncateToDimensions and normalizeL2 columns to embedding_profiles',
  introducedInVersion: '3.2.0',

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('embedding_profiles')) {
      return false;
    }

    const columns = getSQLiteTableColumns('embedding_profiles');
    const hasTruncate = columns.some((col) => col.name === 'truncateToDimensions');
    const hasNormalize = columns.some((col) => col.name === 'normalizeL2');
    return !hasTruncate || !hasNormalize;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();
      const columns = getSQLiteTableColumns('embedding_profiles');
      const hasTruncate = columns.some((col) => col.name === 'truncateToDimensions');
      const hasNormalize = columns.some((col) => col.name === 'normalizeL2');

      if (!hasTruncate) {
        db.exec('ALTER TABLE "embedding_profiles" ADD COLUMN "truncateToDimensions" INTEGER DEFAULT NULL');
      }

      if (!hasNormalize) {
        db.exec('ALTER TABLE "embedding_profiles" ADD COLUMN "normalizeL2" INTEGER DEFAULT 1');
      }

      const updated = getSQLiteTableColumns('embedding_profiles');
      const verifyTruncate = updated.some((col) => col.name === 'truncateToDimensions');
      const verifyNormalize = updated.some((col) => col.name === 'normalizeL2');

      if (!verifyTruncate || !verifyNormalize) {
        throw new Error('Truncation columns were not added successfully');
      }

      logger.info('Added Matryoshka truncation columns to embedding_profiles', {
        context: 'migration.add-embedding-profile-truncation-fields',
      });

      return {
        id: 'add-embedding-profile-truncation-fields-v1',
        success: true,
        itemsAffected: 1,
        message: 'Added truncateToDimensions and normalizeL2 columns to embedding_profiles',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Failed to add Matryoshka truncation columns', {
        context: 'migration.add-embedding-profile-truncation-fields',
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        id: 'add-embedding-profile-truncation-fields-v1',
        success: false,
        itemsAffected: 0,
        message: `Failed to add columns: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
