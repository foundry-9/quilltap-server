/**
 * Startup Auto-Repair: Convert TEXT Embeddings to Float32 BLOBs
 *
 * During development hot-reloads, the SQLiteCollection's blobColumns set can
 * lose its registration, causing embeddings to be written as JSON text instead
 * of compact Float32 BLOBs. This repair runs on every startup and converts any
 * TEXT embeddings back to BLOBs in both `vector_entries` and `memories` tables.
 *
 * This is idempotent and fast when there's nothing to fix (a single COUNT query).
 */

import { logger } from '@/lib/logger'

/**
 * Convert a number[] to a Float32 Buffer
 */
function embeddingToBlob(embedding: number[]): Buffer {
  const float32 = new Float32Array(embedding)
  return Buffer.from(float32.buffer, float32.byteOffset, float32.byteLength)
}

interface RepairResult {
  vectorEntriesRepaired: number
  memoriesRepaired: number
  durationMs: number
}

/**
 * Repair any TEXT embeddings found in vector_entries and memories tables.
 * Converts them to Float32 BLOBs for proper dimension handling and storage efficiency.
 *
 * Safe to call on every startup — returns immediately if no TEXT embeddings exist.
 */
export async function repairTextEmbeddings(): Promise<RepairResult> {
  const startTime = Date.now()
  let vectorEntriesRepaired = 0
  let memoriesRepaired = 0

  try {
    // Dynamic import to avoid circular dependencies during startup
    const { getDatabaseAsync } = await import('@/lib/database/manager')
    const { SQLiteBackend } = await import('@/lib/database/backends/sqlite/backend')

    const backend = await getDatabaseAsync()
    if (!(backend instanceof SQLiteBackend)) {
      return { vectorEntriesRepaired: 0, memoriesRepaired: 0, durationMs: Date.now() - startTime }
    }

    // Access the raw SQLite database for direct queries
    const db = (backend as any).db
    if (!db) {
      return { vectorEntriesRepaired: 0, memoriesRepaired: 0, durationMs: Date.now() - startTime }
    }

    // Check if there are any TEXT embeddings in vector_entries
    const tableExists = (name: string): boolean => {
      try {
        const row = db.prepare(
          `SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name=?`
        ).get(name) as { count: number }
        return row.count > 0
      } catch {
        return false
      }
    }

    // Repair vector_entries
    if (tableExists('vector_entries')) {
      const textCount = db.prepare(
        `SELECT COUNT(*) as count FROM vector_entries WHERE typeof(embedding) = 'text'`
      ).get() as { count: number }

      if (textCount.count > 0) {
        logger.info('Repairing TEXT embeddings in vector_entries', {
          context: 'startup.repair-text-embeddings',
          count: textCount.count,
        })

        const textRows = db.prepare(
          `SELECT id, embedding FROM vector_entries WHERE typeof(embedding) = 'text'`
        ).all() as { id: string; embedding: string }[]

        const updateStmt = db.prepare(
          `UPDATE vector_entries SET embedding = ? WHERE id = ?`
        )

        const batchUpdate = db.transaction((batch: typeof textRows) => {
          for (const row of batch) {
            try {
              const embedding = JSON.parse(row.embedding) as number[]
              if (Array.isArray(embedding) && embedding.length > 0) {
                const blob = embeddingToBlob(embedding)
                updateStmt.run(blob, row.id)
                vectorEntriesRepaired++
              }
            } catch {
              logger.warn('Failed to repair vector_entries embedding, skipping', {
                context: 'startup.repair-text-embeddings',
                entryId: row.id,
              })
            }
          }
        })

        for (let i = 0; i < textRows.length; i += 500) {
          batchUpdate(textRows.slice(i, i + 500))
        }
      }
    }

    // Repair memories
    if (tableExists('memories')) {
      const textCount = db.prepare(
        `SELECT COUNT(*) as count FROM memories WHERE embedding IS NOT NULL AND typeof(embedding) = 'text'`
      ).get() as { count: number }

      if (textCount.count > 0) {
        logger.info('Repairing TEXT embeddings in memories', {
          context: 'startup.repair-text-embeddings',
          count: textCount.count,
        })

        const textRows = db.prepare(
          `SELECT id, embedding FROM memories WHERE embedding IS NOT NULL AND typeof(embedding) = 'text'`
        ).all() as { id: string; embedding: string }[]

        const updateStmt = db.prepare(
          `UPDATE memories SET embedding = ? WHERE id = ?`
        )

        const batchUpdate = db.transaction((batch: typeof textRows) => {
          for (const row of batch) {
            try {
              const embedding = JSON.parse(row.embedding) as number[]
              if (Array.isArray(embedding)) {
                if (embedding.length > 0) {
                  const blob = embeddingToBlob(embedding)
                  updateStmt.run(blob, row.id)
                } else {
                  updateStmt.run(null, row.id)
                }
                memoriesRepaired++
              }
            } catch {
              logger.warn('Failed to repair memories embedding, skipping', {
                context: 'startup.repair-text-embeddings',
                memoryId: row.id,
              })
            }
          }
        })

        for (let i = 0; i < textRows.length; i += 500) {
          batchUpdate(textRows.slice(i, i + 500))
        }
      }
    }

    const durationMs = Date.now() - startTime
    const totalRepaired = vectorEntriesRepaired + memoriesRepaired

    if (totalRepaired > 0) {
      logger.info('TEXT embedding repair complete', {
        context: 'startup.repair-text-embeddings',
        vectorEntriesRepaired,
        memoriesRepaired,
        durationMs,
      })
    }

    return { vectorEntriesRepaired, memoriesRepaired, durationMs }
  } catch (error) {
    logger.error('TEXT embedding repair failed', {
      context: 'startup.repair-text-embeddings',
      error: error instanceof Error ? error.message : String(error),
      vectorEntriesRepaired,
      memoriesRepaired,
    })
    // Non-fatal — don't block startup
    return { vectorEntriesRepaired, memoriesRepaired, durationMs: Date.now() - startTime }
  }
}
