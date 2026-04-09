/**
 * Memory Service
 * Sprint 4: Memory CRUD with Embedding Integration
 *
 * This service wraps memory repository operations and integrates
 * embedding generation and vector store management.
 */

import { getRepositories } from '@/lib/repositories/factory'
import { Memory } from '@/lib/schemas/types'
import { generateEmbeddingForUser, EmbeddingError, cosineSimilarity } from '@/lib/embedding/embedding-service'
import { getCharacterVectorStore, getVectorStoreManager } from '@/lib/embedding/vector-store'
import { logger } from '@/lib/logger'
import {
  runMemoryGate,
  reinforceMemory,
  linkRelatedMemories,
  calculateReinforcedImportance,
} from './memory-gate'
import { calculateEffectiveWeight } from './memory-weighting'
import type { MemoryGateOutcome } from './memory-gate'
export type { MemoryGateOutcome } from './memory-gate'

/**
 * Options for memory creation
 */
export interface CreateMemoryOptions {
  /** Character ID to associate the memory with */
  characterId: string
  /** Memory content */
  content: string
  /** Short summary */
  summary: string
  /** Search keywords */
  keywords?: string[]
  /** Associated tags */
  tags?: string[]
  /** Importance score (0-1) */
  importance?: number
  /** Associated user character ID */
  personaId?: string | null
  /** Character ID this memory is about (for inter-character memories) */
  aboutCharacterId?: string | null
  /** Source chat ID */
  chatId?: string | null
  /** How the memory was created */
  source?: 'AUTO' | 'MANUAL'
  /** Source message ID for auto-created memories */
  sourceMessageId?: string | null
  /** Override createdAt/updatedAt with source message timestamp (for batch extraction) */
  sourceMessageTimestamp?: string
}

/**
 * Options for memory operations
 */
export interface MemoryServiceOptions {
  /** User ID for API access (required for embedding) */
  userId: string
  /** Specific embedding profile ID to use */
  embeddingProfileId?: string
  /** Skip embedding generation (for batch operations or testing) */
  skipEmbedding?: boolean
  /** Skip the Memory Gate check (force-insert without similarity check) */
  skipGate?: boolean
}

/**
 * Result of a semantic memory search
 */
export interface SemanticSearchResult {
  /** The matching memory */
  memory: Memory
  /** Similarity score (0-1) */
  score: number
  /** Whether embedding was used for search */
  usedEmbedding: boolean
  /** Effective weight combining importance with time decay (0-1) */
  effectiveWeight?: number
}

/**
 * Create a memory with optional embedding generation
 *
 * This is the primary function for creating memories. It:
 * 1. Runs the Memory Gate to check for duplicates/related memories (unless skipGate)
 * 2. Based on gate decision: REINFORCE, INSERT_RELATED, or INSERT
 * 3. Generates embedding and adds to vector store
 *
 * Return type unchanged for backward compatibility.
 */
export async function createMemoryWithEmbedding(
  data: CreateMemoryOptions,
  options: MemoryServiceOptions
): Promise<Memory> {
  const outcome = await createMemoryWithGate(data, options)
  return outcome.memory
}

/**
 * Create a memory with gate decision info.
 *
 * Returns full gate outcome (action taken, novel details, related IDs)
 * for callers that need gate action info (e.g., memory-processor).
 */
export async function createMemoryWithGate(
  data: CreateMemoryOptions,
  options: MemoryServiceOptions
): Promise<MemoryGateOutcome> {
  const repos = getRepositories()

  // If gate or embedding is skipped, use the direct creation flow
  if (options.skipGate || options.skipEmbedding) {
    const memory = await createMemoryDirect(data, options)
    return { memory, action: 'SKIP_GATE' }
  }

  // Run the Memory Gate — generate embedding first, then decide
  const gateResult = await runMemoryGate(
    data.characterId,
    data.content,
    data.summary,
    data.keywords || [],
    options.userId,
    options.embeddingProfileId
  )


  const { decision, embedding } = gateResult

  switch (decision.action) {
    case 'REINFORCE': {
      // Boost the existing memory instead of creating a new row
      const { memory: reinforced, novelDetails } = await reinforceMemory(
        decision.existingMemory,
        data.content,
        data.summary,
        options.userId,
        options.embeddingProfileId
      )
      return {
        memory: reinforced,
        action: 'REINFORCE',
        novelDetails,
      }
    }

    case 'INSERT_RELATED': {
      // Create new memory, then bidirectionally link
      const memory = await createMemoryDirectWithEmbedding(data, options, embedding)
      const linkedIds = await linkRelatedMemories(
        memory.id,
        data.characterId,
        decision.relatedMemories
      )
      return {
        memory,
        action: 'INSERT_RELATED',
        relatedMemoryIds: linkedIds,
      }
    }

    case 'INSERT':
    default: {
      // Straightforward insert with pre-computed embedding
      const memory = await createMemoryDirectWithEmbedding(data, options, embedding)
      return { memory, action: 'INSERT' }
    }
  }
}

/**
 * Direct memory creation without gate (original flow).
 * Used when skipGate or skipEmbedding is true.
 */
async function createMemoryDirect(
  data: CreateMemoryOptions,
  options: MemoryServiceOptions
): Promise<Memory> {
  const repos = getRepositories()
  const importance = data.importance ?? 0.5

  // Build create options for timestamp override (batch extraction)
  const createOpts = data.sourceMessageTimestamp
    ? { createdAt: data.sourceMessageTimestamp, updatedAt: data.sourceMessageTimestamp }
    : undefined

  const memory = await repos.memories.create({
    characterId: data.characterId,
    content: data.content,
    summary: data.summary,
    keywords: data.keywords || [],
    tags: data.tags || [],
    importance,
    personaId: data.personaId || null,
    aboutCharacterId: data.aboutCharacterId || null,
    chatId: data.chatId || null,
    source: data.source || 'MANUAL',
    sourceMessageId: data.sourceMessageId || null,
    reinforcementCount: 1,
    relatedMemoryIds: [],
    reinforcedImportance: importance,
  }, createOpts)

  if (options.skipEmbedding) {
    return memory
  }

  // Generate embedding
  try {
    const embeddingResult = await generateEmbeddingForUser(
      `${data.summary}\n\n${data.content}`,
      options.userId,
      options.embeddingProfileId
    )

    const updatedMemory = await repos.memories.updateForCharacter(
      data.characterId,
      memory.id,
      { embedding: embeddingResult.embedding }
    )

    const vectorStore = await getCharacterVectorStore(data.characterId)
    await vectorStore.addVector(memory.id, embeddingResult.embedding, {
      memoryId: memory.id,
      characterId: data.characterId,
    })
    await vectorStore.save()

    return updatedMemory || memory
  } catch (error) {
    if (error instanceof EmbeddingError) {
      logger.warn(`[Memory] Embedding generation failed for memory ${memory.id}: ${error.message}`, { characterId: data.characterId, userId: options.userId })
    } else {
      logger.warn(`[Memory] Unexpected error generating embedding for memory ${memory.id}`, { characterId: data.characterId, userId: options.userId, error: String(error) })
    }
    return memory
  }
}

/**
 * Create a memory and store a pre-computed embedding (from gate).
 * Avoids regenerating the embedding when the gate already computed it.
 */
async function createMemoryDirectWithEmbedding(
  data: CreateMemoryOptions,
  options: MemoryServiceOptions,
  embedding: number[] | null
): Promise<Memory> {
  const repos = getRepositories()
  const importance = data.importance ?? 0.5

  // Build create options for timestamp override (batch extraction)
  const createOpts = data.sourceMessageTimestamp
    ? { createdAt: data.sourceMessageTimestamp, updatedAt: data.sourceMessageTimestamp }
    : undefined

  const memory = await repos.memories.create({
    characterId: data.characterId,
    content: data.content,
    summary: data.summary,
    keywords: data.keywords || [],
    tags: data.tags || [],
    importance,
    personaId: data.personaId || null,
    aboutCharacterId: data.aboutCharacterId || null,
    chatId: data.chatId || null,
    source: data.source || 'MANUAL',
    sourceMessageId: data.sourceMessageId || null,
    reinforcementCount: 1,
    relatedMemoryIds: [],
    reinforcedImportance: importance,
  }, createOpts)

  if (embedding) {
    // Use the pre-computed embedding from the gate
    const updatedMemory = await repos.memories.updateForCharacter(
      data.characterId,
      memory.id,
      { embedding }
    )

    const vectorStore = await getCharacterVectorStore(data.characterId)
    await vectorStore.addVector(memory.id, embedding, {
      memoryId: memory.id,
      characterId: data.characterId,
    })
    await vectorStore.save()

    return updatedMemory || memory
  }

  return memory
}

/**
 * Update a memory and regenerate its embedding if content changed
 */
export async function updateMemoryWithEmbedding(
  characterId: string,
  memoryId: string,
  data: Partial<Memory>,
  options: MemoryServiceOptions
): Promise<Memory | null> {
  const repos = getRepositories()

  // Get the existing memory
  const existingMemory = await repos.memories.findByIdForCharacter(characterId, memoryId)
  if (!existingMemory) {
    return null
  }

  // Check if content changed (requires re-embedding)
  const contentChanged =
    (data.content && data.content !== existingMemory.content) ||
    (data.summary && data.summary !== existingMemory.summary)

  // Update the memory
  const updatedMemory = await repos.memories.updateForCharacter(characterId, memoryId, data)
  if (!updatedMemory) {
    return null
  }

  // Regenerate embedding if content changed
  if (contentChanged && !options.skipEmbedding) {
    try {
      const embeddingResult = await generateEmbeddingForUser(
        `${updatedMemory.summary}\n\n${updatedMemory.content}`,
        options.userId,
        options.embeddingProfileId
      )

      // Update memory with new embedding
      const memoryWithEmbedding = await repos.memories.updateForCharacter(
        characterId,
        memoryId,
        { embedding: embeddingResult.embedding }
      )

      // Update vector store
      const vectorStore = await getCharacterVectorStore(characterId)
      if (vectorStore.hasVector(memoryId)) {
        await vectorStore.updateVector(memoryId, embeddingResult.embedding)
      } else {
        await vectorStore.addVector(memoryId, embeddingResult.embedding, {
          memoryId,
          characterId,
        })
      }
      await vectorStore.save()

      return memoryWithEmbedding || updatedMemory
    } catch (error) {
      logger.warn(`[Memory] Failed to regenerate embedding for memory ${memoryId}`, { characterId, memoryId, userId: options.userId, error: String(error) })
    }
  }

  return updatedMemory
}

/**
 * Delete a memory and remove its vector
 */
export async function deleteMemoryWithVector(
  characterId: string,
  memoryId: string
): Promise<boolean> {
  const repos = getRepositories()

  // Delete from repository
  const deleted = await repos.memories.deleteForCharacter(characterId, memoryId)
  if (!deleted) {
    return false
  }

  // Remove from vector store
  try {
    const vectorStore = await getCharacterVectorStore(characterId)
    await vectorStore.removeVector(memoryId)
    await vectorStore.save()
  } catch (error) {
    logger.warn(`[Memory] Failed to remove vector for memory ${memoryId}`, { characterId, memoryId, error: String(error) })
  }

  return true
}

/**
 * Search memories using semantic similarity
 *
 * Falls back to text-based search if embedding is not available.
 */
export async function searchMemoriesSemantic(
  characterId: string,
  query: string,
  options: MemoryServiceOptions & {
    limit?: number
    minScore?: number
    minImportance?: number
    source?: 'AUTO' | 'MANUAL'
  }
): Promise<SemanticSearchResult[]> {
  const repos = getRepositories()
  const limit = options.limit || 20
  const minScore = options.minScore || 0.0

  // Try semantic search first
  try {
    const embeddingResult = await generateEmbeddingForUser(
      query,
      options.userId,
      options.embeddingProfileId
    )

    const vectorStore = await getCharacterVectorStore(characterId)

    // Search vectors
    const vectorResults = vectorStore.search(
      embeddingResult.embedding,
      limit * 2 // Get more results to filter
    )

    if (vectorResults.length > 0) {
      // Get full memory data for results
      const memories = await repos.memories.findByCharacterId(characterId)
      const memoryMap = new Map(memories.map(m => [m.id, m]))

      let results: SemanticSearchResult[] = vectorResults
        .filter(vr => vr.score >= minScore)
        .map(vr => {
          const memory = memoryMap.get(vr.id)
          if (!memory) return null
          const { effectiveWeight } = calculateEffectiveWeight(memory)
          return {
            memory,
            score: vr.score,
            usedEmbedding: true,
            effectiveWeight,
          } as SemanticSearchResult
        })
        .filter((r): r is SemanticSearchResult => r !== null)

      // Apply additional filters
      if (options.minImportance !== undefined) {
        results = results.filter(r => r.memory.importance >= options.minImportance!)
      }
      if (options.source) {
        results = results.filter(r => r.memory.source === options.source)
      }

      // Combine cosine similarity with effective weight for final ranking
      // Similarity still dominates (60%), but weight influences ordering (40%)
      results.sort((a, b) => {
        const finalScoreA = a.score * 0.6 + (a.effectiveWeight ?? 0) * 0.4
        const finalScoreB = b.score * 0.6 + (b.effectiveWeight ?? 0) * 0.4
        return finalScoreB - finalScoreA
      })

      return results.slice(0, limit)
    }
  } catch (error) {
    logger.warn(`[Memory] Semantic search failed, falling back to text search`, { characterId, query: query.substring(0, 100), userId: options.userId, error: String(error) })
  }

  // Fallback to text-based search
  return searchMemoriesText(characterId, query, options)
}

/**
 * Text-based memory search (fallback when embeddings unavailable)
 */
async function searchMemoriesText(
  characterId: string,
  query: string,
  options: {
    limit?: number
    minImportance?: number
    source?: 'AUTO' | 'MANUAL'
  }
): Promise<SemanticSearchResult[]> {
  const repos = getRepositories()
  const limit = options.limit || 20

  let memories = await repos.memories.searchByContent(characterId, query)

  // Apply filters
  if (options.minImportance !== undefined) {
    memories = memories.filter(m => m.importance >= options.minImportance!)
  }
  if (options.source) {
    memories = memories.filter(m => m.source === options.source)
  }

  // Score based on text matching
  const queryLower = query.toLowerCase()
  const results: SemanticSearchResult[] = memories.map(memory => {
    let score = 0
    const contentLower = memory.content.toLowerCase()
    const summaryLower = memory.summary.toLowerCase()

    // Exact match in summary is highest score
    if (summaryLower.includes(queryLower)) {
      score += 0.5
    }
    // Match in content
    if (contentLower.includes(queryLower)) {
      score += 0.3
    }
    // Keyword matches
    const queryWords = queryLower.split(/\s+/)
    const matchingKeywords = memory.keywords.filter(kw =>
      queryWords.some(qw => kw.toLowerCase().includes(qw))
    )
    score += 0.2 * (matchingKeywords.length / Math.max(memory.keywords.length, 1))

    const { effectiveWeight } = calculateEffectiveWeight(memory)

    return {
      memory,
      score: Math.min(score, 1.0),
      usedEmbedding: false,
      effectiveWeight,
    }
  })

  // Combine text score with effective weight for final ranking
  results.sort((a, b) => {
    const finalScoreA = a.score * 0.6 + (a.effectiveWeight ?? 0) * 0.4
    const finalScoreB = b.score * 0.6 + (b.effectiveWeight ?? 0) * 0.4
    return finalScoreB - finalScoreA
  })

  return results.slice(0, limit)
}

/**
 * Find semantically similar memories for duplicate detection
 */
export async function findSimilarMemories(
  characterId: string,
  content: string,
  summary: string,
  options: MemoryServiceOptions & {
    threshold?: number
  }
): Promise<{ memory: Memory; similarity: number }[]> {
  const threshold = options.threshold || 0.85

  try {
    const embeddingResult = await generateEmbeddingForUser(
      `${summary}\n\n${content}`,
      options.userId,
      options.embeddingProfileId
    )

    const vectorStore = await getCharacterVectorStore(characterId)
    const results = vectorStore.search(embeddingResult.embedding, 10)

    // Get full memory data
    const repos = getRepositories()
    const memories = await repos.memories.findByCharacterId(characterId)
    const memoryMap = new Map(memories.map(m => [m.id, m]))

    return results
      .filter(r => r.score >= threshold)
      .map(r => ({
        memory: memoryMap.get(r.id)!,
        similarity: r.score,
      }))
      .filter(r => r.memory)
  } catch (error) {
    logger.warn(`[Memory] Semantic similarity check failed`, { characterId, threshold: options.threshold, userId: options.userId, error: String(error) })
    return []
  }
}

/**
 * Find semantically similar memories using a pre-computed embedding vector.
 *
 * Avoids redundant embedding generation when the caller already has the vector
 * (e.g., the memory gate).
 */
export async function findSimilarMemoriesWithEmbedding(
  characterId: string,
  embedding: number[],
  options: {
    threshold?: number
    limit?: number
  } = {}
): Promise<{ memory: Memory; similarity: number }[]> {
  const threshold = options.threshold || 0.85
  const limit = options.limit || 10

  try {
    const vectorStore = await getCharacterVectorStore(characterId)
    const results = vectorStore.search(embedding, limit)

    const repos = getRepositories()
    const memories = await repos.memories.findByCharacterId(characterId)
    const memoryMap = new Map(memories.map(m => [m.id, m]))

    return results
      .filter(r => r.score >= threshold)
      .map(r => ({
        memory: memoryMap.get(r.id)!,
        similarity: r.score,
      }))
      .filter(r => r.memory)
  } catch (error) {
    logger.warn('[Memory] Similarity search with embedding failed', { characterId, error: String(error) })
    return []
  }
}

/**
 * Generate embeddings for memories that don't have them yet
 *
 * Useful for backfilling existing memories or after enabling embeddings.
 */
export async function generateMissingEmbeddings(
  characterId: string,
  options: MemoryServiceOptions & {
    batchSize?: number
    onProgress?: (processed: number, total: number, current: Memory) => void
  }
): Promise<{ processed: number; failed: number; skipped: number }> {
  const repos = getRepositories()
  const batchSize = options.batchSize || 10

  // Get all memories without embeddings
  const memories = await repos.memories.findByCharacterId(characterId)
  const memoriesWithoutEmbeddings = memories.filter(
    m => !m.embedding || m.embedding.length === 0
  )

  let processed = 0
  let failed = 0
  let skipped = 0

  const vectorStore = await getCharacterVectorStore(characterId)

  for (const memory of memoriesWithoutEmbeddings) {
    try {
      options.onProgress?.(processed + failed + skipped, memoriesWithoutEmbeddings.length, memory)

      const embeddingResult = await generateEmbeddingForUser(
        `${memory.summary}\n\n${memory.content}`,
        options.userId,
        options.embeddingProfileId
      )

      // Update memory with embedding
      await repos.memories.updateForCharacter(characterId, memory.id, {
        embedding: embeddingResult.embedding,
      })

      // Add to vector store
      await vectorStore.addVector(memory.id, embeddingResult.embedding, {
        memoryId: memory.id,
        characterId,
      })

      processed++

      // Save periodically
      if (processed % batchSize === 0) {
        await vectorStore.save()
      }
    } catch (error) {
      logger.warn(`[Memory] Failed to generate embedding for memory ${memory.id}`, { characterId, memoryId: memory.id, userId: options.userId, error: String(error) })
      failed++
    }
  }

  // Final save
  await vectorStore.save()

  return { processed, failed, skipped }
}

/**
 * Rebuild the vector index for a character from scratch
 *
 * Useful if the vector store becomes corrupted or out of sync.
 */
export async function rebuildVectorIndex(
  characterId: string,
  options: MemoryServiceOptions & {
    onProgress?: (processed: number, total: number) => void
  }
): Promise<{ indexed: number; failed: number }> {
  const repos = getRepositories()
  const manager = getVectorStoreManager()

  // Delete existing index
  await manager.deleteStore(characterId)

  // Get fresh store
  const vectorStore = await manager.getStore(characterId)

  // Get all memories with embeddings
  const memories = await repos.memories.findByCharacterId(characterId)
  const memoriesWithEmbeddings = memories.filter(
    m => m.embedding && m.embedding.length > 0
  )

  let indexed = 0
  let failed = 0

  for (const memory of memoriesWithEmbeddings) {
    try {
      options.onProgress?.(indexed + failed, memoriesWithEmbeddings.length)

      await vectorStore.addVector(memory.id, memory.embedding!, {
        memoryId: memory.id,
        characterId,
      })
      indexed++
    } catch (error) {
      logger.warn(`[Memory] Failed to index memory ${memory.id}`, { characterId, memoryId: memory.id, error: String(error) })
      failed++
    }
  }

  await vectorStore.save()

  return { indexed, failed }
}

/**
 * Delete all memories for a source message with vector store cleanup.
 * Handles multi-character case where one message may have memories for multiple characters.
 *
 * @param sourceMessageId The source message ID
 * @returns Object with count of deleted memories and removed vectors
 */
export async function deleteMemoriesBySourceMessageWithVectors(
  sourceMessageId: string
): Promise<{ deleted: number; vectorsRemoved: number }> {
  const repos = getRepositories()

  // First, find all memories to get character IDs for vector cleanup
  const memories = await repos.memories.findBySourceMessageId(sourceMessageId)

  if (memories.length === 0) {

    return { deleted: 0, vectorsRemoved: 0 }
  }

  // Group memories by character for efficient vector store operations
  const memoryIdsByCharacter = new Map<string, string[]>()
  for (const memory of memories) {
    const existing = memoryIdsByCharacter.get(memory.characterId) || []
    existing.push(memory.id)
    memoryIdsByCharacter.set(memory.characterId, existing)
  }

  // Remove vectors from each character's store
  let vectorsRemoved = 0
  for (const [characterId, memoryIds] of memoryIdsByCharacter) {
    try {
      const vectorStore = await getCharacterVectorStore(characterId)
      for (const memoryId of memoryIds) {
        const removed = vectorStore.hasVector(memoryId)
        if (removed) {
          await vectorStore.removeVector(memoryId)
          vectorsRemoved++
        }
      }
      await vectorStore.save()
    } catch (error) {
      logger.warn('[Memory] Failed to remove vectors for character', {
        characterId,
        memoryCount: memoryIds.length,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // Delete the memories from the database
  const deleted = await repos.memories.deleteBySourceMessageId(sourceMessageId)

  logger.info('[Memory] Cascade deleted memories for source message', {
    sourceMessageId,
    deleted,
    vectorsRemoved,
    characterCount: memoryIdsByCharacter.size,
  })

  return { deleted, vectorsRemoved }
}

/**
 * Delete all memories for multiple source messages (swipe group) with vector cleanup.
 *
 * @param sourceMessageIds Array of source message IDs
 * @returns Object with count of deleted memories and removed vectors
 */
export async function deleteMemoriesBySourceMessagesWithVectors(
  sourceMessageIds: string[]
): Promise<{ deleted: number; vectorsRemoved: number }> {
  if (sourceMessageIds.length === 0) {
    return { deleted: 0, vectorsRemoved: 0 }
  }

  let totalDeleted = 0
  let totalVectorsRemoved = 0

  // Process each message - could be optimized with bulk operations but
  // vector stores are per-character so we need the grouping logic
  for (const sourceMessageId of sourceMessageIds) {
    const result = await deleteMemoriesBySourceMessageWithVectors(sourceMessageId)
    totalDeleted += result.deleted
    totalVectorsRemoved += result.vectorsRemoved
  }

  logger.info('[Memory] Bulk cascade deleted memories for swipe group', {
    messageCount: sourceMessageIds.length,
    totalDeleted,
    totalVectorsRemoved,
  })

  return { deleted: totalDeleted, vectorsRemoved: totalVectorsRemoved }
}
