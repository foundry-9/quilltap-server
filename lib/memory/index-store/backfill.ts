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
import { generateEmbeddingForUser, getDefaultEmbeddingProfile } from '@/lib/embedding/embedding-service'
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

/** {@link enqueueMissingEmbeddings}'s outcome. */
export type EnqueueMissingEmbeddingsResult =
  | { status: 'ok'; enqueued: number; remaining: number }
  | { status: 'no-profile'; remaining: number }

/**
 * Queue an `EMBEDDING_GENERATE` job for up to `limit` memories that have no
 * embedding (one character, or all), under the user's default embedding
 * profile — the background backfill behind `?action=backfill-embeddings` and
 * the graph repair. `remaining` counts every row still without an embedding,
 * the ones just queued included until their jobs run.
 */
export async function enqueueMissingEmbeddings(options: {
  userId: string
  characterId?: string
  limit: number
}): Promise<EnqueueMissingEmbeddingsResult> {
  const repos = getRepositories()
  const missing = await repos.memories.findIdsWithoutEmbedding({ characterId: options.characterId, limit: options.limit })
  if (missing.length === 0) return { status: 'ok', enqueued: 0, remaining: 0 }

  const profile = await getDefaultEmbeddingProfile(options.userId)
  if (!profile) {
    return { status: 'no-profile', remaining: await repos.memories.countWithoutEmbedding(options.characterId) }
  }

  // Lazy, as the maintenance triggers import it: lib/memory never loads the queue at module scope.
  const { enqueueEmbeddingGenerate } = await import('@/lib/background-jobs/queue-service')
  let enqueued = 0
  for (const memory of missing) {
    try {
      await enqueueEmbeddingGenerate(options.userId, {
        entityType: 'MEMORY',
        entityId: memory.id,
        characterId: memory.characterId,
        profileId: profile.id,
      })
      enqueued++
    } catch (error) {
      logger.warn('[Memory backfill] Failed to enqueue an embedding job', {
        memoryId: memory.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  const remaining = await repos.memories.countWithoutEmbedding(options.characterId)
  logger.debug('[Memory backfill] Embedding jobs enqueued', {
    characterId: options.characterId ?? '(all)',
    enqueued,
    remaining,
  })
  return { status: 'ok', enqueued, remaining }
}
