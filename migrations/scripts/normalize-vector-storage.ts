/**
 * Migration: Normalize Vector Embedding Storage to Float32 BLOBs
 *
 * Converts vector embeddings from JSON text to compact Float32 BLOB format:
 * 1. Creates `vector_entries` table for per-embedding rows
 * 2. Migrates entries from `vector_indices.entries` JSON column to `vector_entries` rows
 * 3. Drops the `entries` column from `vector_indices`
 * 4. Converts `memories.embedding` from JSON TEXT to Float32 BLOB in-place
 *
 * This achieves ~4-5x storage reduction and eliminates JSON parse/serialize overhead.
 *
 * Migration ID: normalize-vector-storage-v1
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
 * Convert a number[] to a Float32 Buffer
 */
function embeddingToBlob(embedding: number[]): Buffer {
  const float32 = new Float32Array(embedding);
  return Buffer.from(float32.buffer, float32.byteOffset, float32.byteLength);
}

export const normalizeVectorStorageMigration: Migration = {
  id: 'normalize-vector-storage-v1',
  description: 'Normalize vector embeddings from JSON text to Float32 BLOBs',
  introducedInVersion: '2.11.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    // Need to run if vector_entries table doesn't exist
    if (!sqliteTableExists('vector_entries')) {
      return true;
    }

    // Need to run if vector_indices still has an entries column
    if (sqliteTableExists('vector_indices')) {
      const columns = getSQLiteTableColumns('vector_indices');
      if (columns.some(col => col.name === 'entries')) {
        return true;
      }
    }

    // Need to run if memories.embedding still has TEXT data
    if (sqliteTableExists('memories')) {
      const db = getSQLiteDatabase();
      const textEmbeddings = db.prepare(
        `SELECT COUNT(*) as count FROM memories WHERE embedding IS NOT NULL AND typeof(embedding) = 'text'`
      ).get() as { count: number };
      if (textEmbeddings.count > 0) {
        return true;
      }
    }

    return false;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let vectorEntriesMigrated = 0;
    let memoriesConverted = 0;

    try {
      const db = getSQLiteDatabase();

      // Step 1: Create vector_entries table if not exists
      if (!sqliteTableExists('vector_entries')) {
        db.exec(`CREATE TABLE IF NOT EXISTS "vector_entries" (
          "id" TEXT PRIMARY KEY,
          "characterId" TEXT NOT NULL,
          "embedding" BLOB NOT NULL,
          "createdAt" TEXT NOT NULL
        )`);
        db.exec(`CREATE INDEX IF NOT EXISTS "idx_vector_entries_characterId" ON "vector_entries" ("characterId")`);

        logger.info('Created vector_entries table', {
          context: 'migrations.normalize-vector-storage',
        });
      }

      // Step 2: Migrate entries from vector_indices.entries JSON to vector_entries rows
      if (sqliteTableExists('vector_indices')) {
        const columns = getSQLiteTableColumns('vector_indices');
        const hasEntriesColumn = columns.some(col => col.name === 'entries');

        if (hasEntriesColumn) {
          const rows = db.prepare(
            `SELECT id, "characterId", entries FROM vector_indices WHERE entries IS NOT NULL AND entries != '[]'`
          ).all() as { id: string; characterId: string; entries: string }[];

          logger.info('Migrating vector index entries to normalized table', {
            context: 'migrations.normalize-vector-storage',
            indexCount: rows.length,
          });

          const insertStmt = db.prepare(
            `INSERT OR IGNORE INTO "vector_entries" ("id", "characterId", "embedding", "createdAt") VALUES (?, ?, ?, ?)`
          );

          for (const row of rows) {
            try {
              const entries = JSON.parse(row.entries) as Array<{
                id: string;
                embedding: number[];
                createdAt?: string;
              }>;

              // Process in batches of 100
              const batchInsert = db.transaction((batch: typeof entries) => {
                for (const entry of batch) {
                  if (entry.embedding && entry.embedding.length > 0) {
                    const blob = embeddingToBlob(entry.embedding);
                    insertStmt.run(
                      entry.id,
                      row.characterId,
                      blob,
                      entry.createdAt || new Date().toISOString()
                    );
                    vectorEntriesMigrated++;
                  }
                }
              });

              // Process in batches of 100
              for (let i = 0; i < entries.length; i += 100) {
                const batch = entries.slice(i, i + 100);
                batchInsert(batch);
              }
            } catch (parseError) {
              logger.warn('Failed to parse entries for vector index, skipping', {
                context: 'migrations.normalize-vector-storage',
                indexId: row.id,
                characterId: row.characterId,
                error: parseError instanceof Error ? parseError.message : String(parseError),
              });
            }
          }

          // Step 3: Drop entries column from vector_indices
          // SQLite 3.35+ supports ALTER TABLE DROP COLUMN; better-sqlite3 bundles 3.44+
          try {
            db.exec(`ALTER TABLE "vector_indices" DROP COLUMN "entries"`);
            logger.info('Dropped entries column from vector_indices', {
              context: 'migrations.normalize-vector-storage',
            });
          } catch (dropError) {
            // If DROP COLUMN fails (shouldn't with modern SQLite), log and continue
            logger.warn('Could not drop entries column (non-critical)', {
              context: 'migrations.normalize-vector-storage',
              error: dropError instanceof Error ? dropError.message : String(dropError),
            });
          }
        }
      }

      // Step 4: Convert memories.embedding from JSON TEXT to Float32 BLOB
      if (sqliteTableExists('memories')) {
        const textRows = db.prepare(
          `SELECT id, embedding FROM memories WHERE embedding IS NOT NULL AND typeof(embedding) = 'text'`
        ).all() as { id: string; embedding: string }[];

        if (textRows.length > 0) {
          logger.info('Converting memory embeddings from TEXT to BLOB', {
            context: 'migrations.normalize-vector-storage',
            count: textRows.length,
          });

          const updateStmt = db.prepare(
            `UPDATE memories SET embedding = ? WHERE id = ?`
          );

          // Process in batches of 500
          const batchUpdate = db.transaction((batch: typeof textRows) => {
            for (const row of batch) {
              try {
                const embedding = JSON.parse(row.embedding) as number[];
                if (Array.isArray(embedding) && embedding.length > 0) {
                  const blob = embeddingToBlob(embedding);
                  updateStmt.run(blob, row.id);
                  memoriesConverted++;
                }
              } catch {
                // Skip rows with unparseable embeddings
                logger.warn('Failed to convert memory embedding, skipping', {
                  context: 'migrations.normalize-vector-storage',
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

      // Step 5: Rebuild vector_entries from memories.embedding (catch-all)
      // This ensures that all memories with BLOB embeddings have corresponding
      // vector_entries rows, even if the original vector_indices.entries JSON
      // was corrupted or truncated.
      let vectorEntriesRebuilt = 0;
      if (sqliteTableExists('memories') && sqliteTableExists('vector_entries')) {
        const memoriesWithEmbeddings = db.prepare(
          `SELECT m.id, m."characterId", m.embedding, m."createdAt"
           FROM memories m
           WHERE m.embedding IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM vector_entries ve WHERE ve.id = m.id)`
        ).all() as { id: string; characterId: string; embedding: Buffer | string; createdAt: string }[];

        if (memoriesWithEmbeddings.length > 0) {
          logger.info('Rebuilding missing vector entries from memories', {
            context: 'migrations.normalize-vector-storage',
            count: memoriesWithEmbeddings.length,
          });

          const insertEntryStmt = db.prepare(
            `INSERT OR IGNORE INTO "vector_entries" ("id", "characterId", "embedding", "createdAt") VALUES (?, ?, ?, ?)`
          );

          const batchRebuild = db.transaction((batch: typeof memoriesWithEmbeddings) => {
            for (const row of batch) {
              let blob: Buffer;
              if (Buffer.isBuffer(row.embedding)) {
                blob = row.embedding;
              } else if (typeof row.embedding === 'string') {
                try {
                  const parsed = JSON.parse(row.embedding) as number[];
                  blob = embeddingToBlob(parsed);
                } catch {
                  continue;
                }
              } else {
                continue;
              }
              insertEntryStmt.run(row.id, row.characterId, blob, row.createdAt);
              vectorEntriesRebuilt++;
            }
          });

          for (let i = 0; i < memoriesWithEmbeddings.length; i += 500) {
            const batch = memoriesWithEmbeddings.slice(i, i + 500);
            batchRebuild(batch);
          }

          // Update vector_indices metadata for each character that got entries rebuilt
          const characterIds = [...new Set(memoriesWithEmbeddings.map(m => m.characterId))];
          const upsertMetaStmt = db.prepare(
            `INSERT INTO "vector_indices" ("id", "characterId", "version", "dimensions", "createdAt", "updatedAt")
             VALUES (?, ?, 1, ?, ?, ?)
             ON CONFLICT("id") DO UPDATE SET "updatedAt" = excluded."updatedAt", "dimensions" = excluded."dimensions"`
          );
          const now = new Date().toISOString();
          for (const charId of characterIds) {
            // Get dimensions from the first entry for this character
            const firstEntry = db.prepare(
              `SELECT embedding FROM vector_entries WHERE "characterId" = ? LIMIT 1`
            ).get(charId) as { embedding: Buffer } | undefined;
            const dims = firstEntry ? firstEntry.embedding.byteLength / 4 : 0;
            upsertMetaStmt.run(charId, charId, dims, now, now);
          }

          logger.info('Rebuilt missing vector entries from memories', {
            context: 'migrations.normalize-vector-storage',
            rebuilt: vectorEntriesRebuilt,
            characters: characterIds.length,
          });
        }
      }

      const durationMs = Date.now() - startTime;
      const totalAffected = vectorEntriesMigrated + memoriesConverted + vectorEntriesRebuilt;

      logger.info('Vector storage normalization migration completed', {
        context: 'migrations.normalize-vector-storage',
        vectorEntriesMigrated,
        memoriesConverted,
        vectorEntriesRebuilt,
        durationMs,
      });

      return {
        id: 'normalize-vector-storage-v1',
        success: true,
        itemsAffected: totalAffected,
        message: `Migrated ${vectorEntriesMigrated} vector entries to BLOB rows, converted ${memoriesConverted} memory embeddings to BLOB, rebuilt ${vectorEntriesRebuilt} missing entries from memories`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Vector storage normalization migration failed', {
        context: 'migrations.normalize-vector-storage',
        error: errorMessage,
        vectorEntriesMigrated,
        memoriesConverted,
      });

      return {
        id: 'normalize-vector-storage-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to normalize vector storage',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
