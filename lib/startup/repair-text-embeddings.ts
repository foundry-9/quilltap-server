/**
 * Startup Auto-Repair: Convert TEXT Embeddings to Float32 BLOBs
 *
 * During development hot-reloads, the SQLiteCollection's blobColumns set can
 * lose its registration, causing embeddings to be written as JSON text instead
 * of compact Float32 BLOBs. This repair runs on every startup and converts any
 * TEXT embeddings back to BLOBs in both `vector_entries` and `memories` tables.
 *
 * This is idempotent and fast when there's nothing to fix (a single COUNT query).
 *
 * Memory-bounded: pages through TEXT rows in batches of PAGE_SIZE rather than
 * materializing the entire result set with .all(). A 1536- or 4096-dimension
 * embedding stored as JSON text is ~30 KB; 32 k such rows in one .all() will
 * push the heap past 1 GB before V8 string overhead and easily OOM on large
 * instances. Each iteration's WHERE filter re-targets the remaining TEXT
 * rows — once a row has been converted to BLOB, it falls out of the page.
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

const PAGE_SIZE = 500

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
    const { startupProgress } = await import('@/lib/startup/progress')

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

        startupProgress.setCurrent('subsystem:embedding-repair:start', {
          detail: `${textCount.count} vector_entries rows`,
        })

        const selectPage = db.prepare(
          `SELECT id, embedding FROM vector_entries
           WHERE typeof(embedding) = 'text'
           LIMIT ${PAGE_SIZE}`
        )
        const updateStmt = db.prepare(
          `UPDATE vector_entries SET embedding = ? WHERE id = ?`
        )

        const applyPage = db.transaction((batch: { id: string; embedding: string }[]) => {
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

        // Page until no TEXT rows remain. UPDATEs in applyPage flip rows out
        // of the WHERE filter, so progress is guaranteed as long as at least
        // one row converts each iteration.
        let stalledIterations = 0
        while (true) {
          const page = selectPage.all() as { id: string; embedding: string }[]
          if (page.length === 0) break
          const before = vectorEntriesRepaired
          applyPage(page)
          const converted = vectorEntriesRepaired - before
          startupProgress.setSubProgress([
            { current: vectorEntriesRepaired, total: textCount.count, unit: 'vector entries' },
          ])
          if (converted === 0) {
            // No row in this page could be parsed — break to avoid infinite loop.
            // Remaining rows will be flagged again on the next startup.
            stalledIterations++
            if (stalledIterations >= 2) {
              logger.warn('Stopping vector_entries repair — page of unparseable rows', {
                context: 'startup.repair-text-embeddings',
                remaining: page.length,
              })
              // Nudge the remaining unparseable rows to NULL so they don't
              // re-trip the repair on every restart. Index lookups will treat
              // them as missing embeddings, same as never-embedded rows.
              const nullify = db.prepare(
                `UPDATE vector_entries SET embedding = NULL WHERE id = ?`
              )
              const nullifyBatch = db.transaction((ids: string[]) => {
                for (const id of ids) nullify.run(id)
              })
              nullifyBatch(page.map(r => r.id))
              break
            }
          } else {
            stalledIterations = 0
          }
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

        startupProgress.setCurrent('subsystem:embedding-repair:start', {
          detail: `${textCount.count} memories rows`,
        })

        const selectPage = db.prepare(
          `SELECT id, embedding FROM memories
           WHERE embedding IS NOT NULL AND typeof(embedding) = 'text'
           LIMIT ${PAGE_SIZE}`
        )
        const updateStmt = db.prepare(
          `UPDATE memories SET embedding = ? WHERE id = ?`
        )

        const applyPage = db.transaction((batch: { id: string; embedding: string }[]) => {
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

        let stalledIterations = 0
        while (true) {
          const page = selectPage.all() as { id: string; embedding: string }[]
          if (page.length === 0) break
          const before = memoriesRepaired
          applyPage(page)
          const converted = memoriesRepaired - before
          startupProgress.setSubProgress([
            { current: memoriesRepaired, total: textCount.count, unit: 'memories' },
          ])
          if (converted === 0) {
            stalledIterations++
            if (stalledIterations >= 2) {
              logger.warn('Stopping memories repair — page of unparseable rows', {
                context: 'startup.repair-text-embeddings',
                remaining: page.length,
              })
              const nullify = db.prepare(
                `UPDATE memories SET embedding = NULL WHERE id = ?`
              )
              const nullifyBatch = db.transaction((ids: string[]) => {
                for (const id of ids) nullify.run(id)
              })
              nullifyBatch(page.map(r => r.id))
              break
            }
          } else {
            stalledIterations = 0
          }
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
      const { startupProgress } = await import('@/lib/startup/progress')
      startupProgress.publish({
        rawLabel: 'subsystem:embedding-repair:complete',
        detail: `${vectorEntriesRepaired} vector entries, ${memoriesRepaired} memories`,
      })
      startupProgress.setSubProgress(null)
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
