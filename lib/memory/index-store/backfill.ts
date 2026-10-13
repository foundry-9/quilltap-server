/**
 * The index's two maintenance operations behind the Memories API: backfill the
 * rows that have no embedding, and reload a character's cache from its rows.
 * Moved from the retired `memory-service.ts` (memory refactor Phase E); search
 * lives in `lib/memory/recall/`.
 *
 * @module memory/index-store/backfill
 */

import { getRepositories } from '@/lib/repositories/factory'
import type { Memory } from '@/lib/schemas/types'
import { generateEmbeddingForUser } from '@/lib/embedding/embedding-service'
import { logger } from '@/lib/logger'
import { memoryIndex } from './memory-index'
import { embeddingTextFor, lexicalEmbeddingTextFor } from './embedding-text'
import { refreshMemoryTimeZone } from '../time/calendar-refresh'

/** Who is asking, and with which embedding profile. */
export interface BackfillOptions {
  userId: string
  embeddingProfileId?: string
}

/**
 * Generate embeddings for memories that don't have them yet
 *
 * Useful for backfilling existing memories or after enabling embeddings.
 */
export async function generateMissingEmbeddings(
  characterId: string,
  options: BackfillOptions & {
    onProgress?: (processed: number, total: number, current: Memory) => void
  }
): Promise<{ processed: number; failed: number; skipped: number }> {
  const repos = getRepositories()

  // Get all memories without embeddings
  const memories = await repos.memories.findByCharacterId(characterId)
  const memoriesWithoutEmbeddings = memories.filter(
    m => !m.embedding || m.embedding.length === 0
  )

  let processed = 0
  let failed = 0
  let skipped = 0

  // Anchor dates render on the instance's memory calendar.
  const memoryTimeZone = await refreshMemoryTimeZone()

  for (const memory of memoriesWithoutEmbeddings) {
    try {
      options.onProgress?.(processed + failed + skipped, memoriesWithoutEmbeddings.length, memory)

      const embeddingResult = await generateEmbeddingForUser(
        embeddingTextFor(memory, memoryTimeZone),
        options.userId,
        options.embeddingProfileId,
        { priority: 'background', lexicalText: lexicalEmbeddingTextFor(memory) }
      )

      // Row and index in one call; the row's tier rides with the vector.
      await memoryIndex.upsert(characterId, [
        { id: memory.id, embedding: embeddingResult.embedding, tier: memory.tier === 'cold' ? 'cold' : 'hot' },
      ])
      processed++
    } catch (error) {
      logger.warn(`[Memory] Failed to generate embedding for memory ${memory.id}`, { characterId, memoryId: memory.id, userId: options.userId, error: String(error) })
      failed++
    }
  }

  logger.debug('[Memory] Backfilled missing embeddings', { characterId, processed, failed, skipped })
  return { processed, failed, skipped }
}

/**
 * Rebuild a character's vector index.
 *
 * The rows are the index (`memories.embedding` + `memories.tier`); the
 * in-process store is only a cache of them. Rebuilding drops the cache and
 * reads the rows again, so the tiers come with the vectors (bug 205 cannot
 * recur). Reports how many vectors the reloaded index holds, and how many of
 * the character's rows have none (those need `generate-embeddings`).
 */
export async function rebuildVectorIndex(
  characterId: string,
): Promise<{ indexed: number; failed: number }> {
  memoryIndex.reload(characterId)
  const entries = await memoryIndex.entries(characterId)
  const coldIndexed = entries.filter(e => e.metadata.tier === 'cold').length
  const failed = await getRepositories().memories.countWithoutEmbedding(characterId)

  logger.debug('[Memory] Rebuilt vector index from memory rows', {
    characterId,
    indexed: entries.length,
    coldIndexed,
    withoutEmbedding: failed,
  })

  return { indexed: entries.length, failed }
}
