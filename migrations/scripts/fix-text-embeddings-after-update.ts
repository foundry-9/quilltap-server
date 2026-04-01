/**
 * Migration: Fix TEXT Embeddings Written by Update Path
 *
 * The translateUpdate function in the SQLite query translator did not know about
 * blob columns, so updateOne/updateMany would write embeddings back as JSON TEXT
 * instead of Float32 BLOBs. This undid the work of normalize-vector-storage-v1.
 *
 * This migration re-converts any TEXT embeddings back to Float32 BLOBs in both
 * `memories.embedding` and `vector_entries.embedding`.
 *
 * Migration ID: fix-text-embeddings-after-update-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';

/**
 * Convert a number[] to a Float32 Buffer
 */
function embeddingToBlob(embedding: number[]): Buffer {
  const float32 = new Float32Array(embedding);
  return Buffer.from(float32.buffer, float32.byteOffset, float32.byteLength);
}

export const fixTextEmbeddingsAfterUpdateMigration: Migration = {
  id: 'fix-text-embeddings-after-update-v1',
  description: 'Fix TEXT embeddings written back by the update path (should be Float32 BLOBs)',
  introducedInVersion: '3.1.0',
  dependsOn: ['normalize-vector-storage-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    const db = getSQLiteDatabase();

    // Check memories.embedding for TEXT data
    if (sqliteTableExists('memories')) {
      const textMemories = db.prepare(
        `SELECT COUNT(*) as count FROM memories WHERE embedding IS NOT NULL AND typeof(embedding) = 'text'`
      ).get() as { count: number };
      if (textMemories.count > 0) {
        return true;
      }
    }

    // Check vector_entries.embedding for TEXT data
    if (sqliteTableExists('vector_entries')) {
      const textEntries = db.prepare(
        `SELECT COUNT(*) as count FROM vector_entries WHERE typeof(embedding) = 'text'`
      ).get() as { count: number };
      if (textEntries.count > 0) {
        return true;
      }
    }

    return false;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let memoriesConverted = 0;
    let vectorEntriesConverted = 0;

    try {
      const db = getSQLiteDatabase();

      // Convert memories.embedding TEXT → BLOB
      if (sqliteTableExists('memories')) {
        const textRows = db.prepare(
          `SELECT id, embedding FROM memories WHERE embedding IS NOT NULL AND typeof(embedding) = 'text'`
        ).all() as { id: string; embedding: string }[];

        if (textRows.length > 0) {
          logger.info('Converting memory embeddings from TEXT back to BLOB', {
            context: 'migrations.fix-text-embeddings-after-update',
            count: textRows.length,
          });

          const updateStmt = db.prepare(
            `UPDATE memories SET embedding = ? WHERE id = ?`
          );

          const batchUpdate = db.transaction((batch: typeof textRows) => {
            for (const row of batch) {
              try {
                const embedding = JSON.parse(row.embedding) as number[];
                if (Array.isArray(embedding)) {
                  if (embedding.length > 0) {
                    const blob = embeddingToBlob(embedding);
                    updateStmt.run(blob, row.id);
                    memoriesConverted++;
                  } else {
                    updateStmt.run(null, row.id);
                    memoriesConverted++;
                  }
                }
              } catch {
                logger.warn('Failed to convert memory embedding, skipping', {
                  context: 'migrations.fix-text-embeddings-after-update',
                  memoryId: row.id,
                });
              }
            }
          });

          for (let i = 0; i < textRows.length; i += 500) {
            const batch = textRows.slice(i, i + 500);
            batchUpdate(batch);
          }
        }
      }

      // Convert vector_entries.embedding TEXT → BLOB
      if (sqliteTableExists('vector_entries')) {
        const textRows = db.prepare(
          `SELECT id, embedding FROM vector_entries WHERE typeof(embedding) = 'text'`
        ).all() as { id: string; embedding: string }[];

        if (textRows.length > 0) {
          logger.info('Converting vector_entries embeddings from TEXT back to BLOB', {
            context: 'migrations.fix-text-embeddings-after-update',
            count: textRows.length,
          });

          const updateStmt = db.prepare(
            `UPDATE vector_entries SET embedding = ? WHERE id = ?`
          );

          const batchUpdate = db.transaction((batch: typeof textRows) => {
            for (const row of batch) {
              try {
                const embedding = JSON.parse(row.embedding) as number[];
                if (Array.isArray(embedding) && embedding.length > 0) {
                  const blob = embeddingToBlob(embedding);
                  updateStmt.run(blob, row.id);
                  vectorEntriesConverted++;
                }
              } catch {
                logger.warn('Failed to convert vector_entries embedding, skipping', {
                  context: 'migrations.fix-text-embeddings-after-update',
                  entryId: row.id,
                });
              }
            }
          });

          for (let i = 0; i < textRows.length; i += 500) {
            const batch = textRows.slice(i, i + 500);
            batchUpdate(batch);
          }
        }
      }

      const durationMs = Date.now() - startTime;
      const totalAffected = memoriesConverted + vectorEntriesConverted;

      logger.info('Fix TEXT embeddings migration completed', {
        context: 'migrations.fix-text-embeddings-after-update',
        memoriesConverted,
        vectorEntriesConverted,
        durationMs,
      });

      return {
        id: 'fix-text-embeddings-after-update-v1',
        success: true,
        itemsAffected: totalAffected,
        message: `Converted ${memoriesConverted} memory embeddings and ${vectorEntriesConverted} vector_entries embeddings from TEXT back to Float32 BLOB`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Fix TEXT embeddings migration failed', {
        context: 'migrations.fix-text-embeddings-after-update',
        error: errorMessage,
        memoriesConverted,
        vectorEntriesConverted,
      });

      return {
        id: 'fix-text-embeddings-after-update-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to fix TEXT embeddings',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
