/**
 * Memory Deduplication Tool
 *
 * Identifies semantically duplicate memories across all characters using
 * cosine similarity, clusters them with Union-Find, selects the best
 * survivor from each cluster, merges novel details from discarded memories
 * into survivors, and removes the duplicates.
 *
 * Ported from temp/memory_dedupe.py to work against the live database.
 */

import { Memory } from '@/lib/schemas/types'
import { cosineSimilarity } from '@/lib/embedding/embedding-service'
import { extractNovelDetails } from '@/lib/memory/memory-gate'
import { getRepositories } from '@/lib/repositories/factory'
import { getUserRepositories } from '@/lib/repositories/factory'
import { getCharacterVectorStore } from '@/lib/embedding/vector-store'
import { logger } from '@/lib/logger'

// =============================================================================
// Types
// =============================================================================

/** Result for a single cluster of duplicate memories */
export interface DedupClusterResult {
  size: number
  survivorId: string
  survivorSummary: string
  survivorImportance: number
  removedCount: number
  removedSummaries: string[]
  mergedDetailCount: number
}

/** Per-character deduplication result */
export interface CharacterDedupResult {
  characterId: string
  characterName: string
  originalCount: number
  withEmbeddings: number
  withoutEmbeddings: number
  clustersFound: number
  memoriesInClusters: number
  removedCount: number
  mergedDetailCount: number
  finalCount: number
  clusters: DedupClusterResult[]
}

/** Overall deduplication result */
export interface DedupResult {
  threshold: number
  dryRun: boolean
  characters: CharacterDedupResult[]
  totalOriginal: number
  totalRemoved: number
  totalMergedDetails: number
  totalFinal: number
  processedAt: string
}

// =============================================================================
// Union-Find
// =============================================================================

/**
 * Union-Find (Disjoint Set) data structure with path compression and union by rank.
 * Used to transitively cluster similar memories.
 */
class UnionFind {
  private parent: number[]
  private rank: number[]

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i)
    this.rank = new Array(n).fill(0)
  }

  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]] // path compression
      x = this.parent[x]
    }
    return x
  }

  union(x: number, y: number): void {
    let rx = this.find(x)
    let ry = this.find(y)
    if (rx === ry) return

    // union by rank
    if (this.rank[rx] < this.rank[ry]) {
      ;[rx, ry] = [ry, rx]
    }
    this.parent[ry] = rx
    if (this.rank[rx] === this.rank[ry]) {
      this.rank[rx]++
    }
  }
}

// =============================================================================
// Scoring
// =============================================================================

/**
 * Score a memory for survivor selection. Higher = better candidate to keep.
 *
 * Factors: importance (weighted heavily), content length, and specificity
 * markers (proper nouns, numbers, technical terms).
 */
function scoreMemory(memory: Memory): number {
  const content = memory.content || ''
  const importance = memory.importance || 0.5
  const length = content.length

  let specificity = 0

  // Proper nouns / capitalized words (rough heuristic)
  const caps = (content.match(/\b[A-Z][a-z]{2,}/g) || []).length
  specificity += Math.min(caps, 10) * 2

  // Numbers and dates
  const nums = (content.match(/\b\d+\b/g) || []).length
  specificity += Math.min(nums, 5) * 3

  // Technical terms (code-like tokens)
  const tech = (content.match(/[A-Za-z]+\.[A-Za-z]+|[a-z]+_[a-z]+|\b(?:API|SQL|JSON|HTTP|AWS|Azure)\b/gi) || []).length
  specificity += Math.min(tech, 5) * 4

  return (importance * 100) + (length * 0.1) + specificity
}

// =============================================================================
// Per-Character Deduplication
// =============================================================================

/**
 * Deduplicate memories for a single character.
 *
 * 1. Fetch all memories, separate by has-embedding vs no-embedding
 * 2. Group embedded memories by dimension length
 * 3. Compute pairwise cosine similarity within each dimension group
 * 4. Cluster via Union-Find at threshold
 * 5. Score and select survivors from each multi-member cluster
 * 6. Extract novel details from discarded memories
 * 7. Append to survivors as [+] footnotes
 * 8. If not dryRun: update survivors, bulk-delete discards, clean vector store
 * 9. Return CharacterDedupResult
 */
export async function deduplicateCharacterMemories(
  characterId: string,
  characterName: string,
  threshold: number,
  dryRun: boolean
): Promise<CharacterDedupResult> {
  const repos = getRepositories()


  // Fetch all memories
  const allMemories = await repos.memories.findByCharacterId(characterId)
  const originalCount = allMemories.length

  if (originalCount < 2) {
    return {
      characterId,
      characterName,
      originalCount,
      withEmbeddings: allMemories.filter(m => m.embedding && m.embedding.length > 0).length,
      withoutEmbeddings: allMemories.filter(m => !m.embedding || m.embedding.length === 0).length,
      clustersFound: 0,
      memoriesInClusters: 0,
      removedCount: 0,
      mergedDetailCount: 0,
      finalCount: originalCount,
      clusters: [],
    }
  }

  // Separate embedded vs non-embedded
  const withEmbeddings = allMemories.filter(m => m.embedding && m.embedding.length > 0)
  const withoutEmbeddings = allMemories.filter(m => !m.embedding || m.embedding.length === 0)


  if (withEmbeddings.length < 2) {
    return {
      characterId,
      characterName,
      originalCount,
      withEmbeddings: withEmbeddings.length,
      withoutEmbeddings: withoutEmbeddings.length,
      clustersFound: 0,
      memoriesInClusters: 0,
      removedCount: 0,
      mergedDetailCount: 0,
      finalCount: originalCount,
      clusters: [],
    }
  }

  // Group by embedding dimension length (to avoid comparing mismatched vectors)
  const dimensionGroups = new Map<number, Memory[]>()
  for (const memory of withEmbeddings) {
    const dimLen = memory.embedding!.length
    if (!dimensionGroups.has(dimLen)) {
      dimensionGroups.set(dimLen, [])
    }
    dimensionGroups.get(dimLen)!.push(memory)
  }


  // Process each dimension group
  const allClusters: DedupClusterResult[] = []
  const allSurvivorUpdates: Array<{ memoryId: string; newContent: string }> = []
  const allRemoveIds: string[] = []
  let totalMergedDetails = 0

  for (const [dim, memories] of dimensionGroups) {
    if (memories.length < 2) continue
    // Pairwise cosine similarity + Union-Find clustering
    const uf = new UnionFind(memories.length)

    for (let i = 0; i < memories.length; i++) {
      for (let j = i + 1; j < memories.length; j++) {
        const sim = cosineSimilarity(memories[i].embedding!, memories[j].embedding!)
        if (sim >= threshold) {
          uf.union(i, j)
        }
      }
    }

    // Collect clusters
    const clusterMap = new Map<number, number[]>()
    for (let i = 0; i < memories.length; i++) {
      const root = uf.find(i)
      if (!clusterMap.has(root)) {
        clusterMap.set(root, [])
      }
      clusterMap.get(root)!.push(i)
    }

    // Process multi-member clusters
    for (const [, memberIndices] of clusterMap) {
      if (memberIndices.length < 2) continue

      // Score each member and pick the best survivor
      const scored = memberIndices.map(idx => ({
        idx,
        memory: memories[idx],
        score: scoreMemory(memories[idx]),
      }))
      scored.sort((a, b) => b.score - a.score)

      const survivor = scored[0]
      const discards = scored.slice(1)

      // Extract novel details from discards and merge into survivor
      const allNovelDetails: string[] = []
      const seenDetails = new Set<string>()

      for (const discard of discards) {
        const novelDetails = extractNovelDetails(discard.memory.content, survivor.memory.content)
        for (const detail of novelDetails) {
          const key = detail.toLowerCase().trim()
          if (!seenDetails.has(key)) {
            seenDetails.add(key)
            allNovelDetails.push(detail)
          }
        }
      }

      totalMergedDetails += allNovelDetails.length

      // Build updated survivor content with [+] footnotes
      if (allNovelDetails.length > 0) {
        const footnotes = allNovelDetails.map(d => `[+] ${d}`).join('\n')
        const newContent = `${survivor.memory.content}\n${footnotes}`
        allSurvivorUpdates.push({
          memoryId: survivor.memory.id,
          newContent,
        })
      }

      // Collect discard IDs
      for (const discard of discards) {
        allRemoveIds.push(discard.memory.id)
      }

      allClusters.push({
        size: memberIndices.length,
        survivorId: survivor.memory.id,
        survivorSummary: (survivor.memory.summary || '').slice(0, 120),
        survivorImportance: survivor.memory.importance,
        removedCount: discards.length,
        removedSummaries: discards.slice(0, 3).map(d => (d.memory.summary || '').slice(0, 100)),
        mergedDetailCount: allNovelDetails.length,
      })
    }
  }

  const removedCount = allRemoveIds.length
  const finalCount = originalCount - removedCount

  // Apply changes if not dry run
  if (!dryRun && (allSurvivorUpdates.length > 0 || allRemoveIds.length > 0)) {
    // Update survivors with merged content
    for (const update of allSurvivorUpdates) {
      const now = new Date().toISOString()
      await repos.memories.updateForCharacter(characterId, update.memoryId, {
        content: update.newContent,
        updatedAt: now,
      })
    }

    // Bulk delete discarded memories
    if (allRemoveIds.length > 0) {
      const deletedCount = await repos.memories.bulkDelete(characterId, allRemoveIds)
      logger.info('[MemoryDedup] Bulk deleted memories', {
        context: 'memory-dedup.deduplicateCharacterMemories',
        characterId,
        requested: allRemoveIds.length,
        deleted: deletedCount,
      })

      // Clean up vector store
      try {
        const vectorStore = await getCharacterVectorStore(characterId)
        for (const id of allRemoveIds) {
          await vectorStore.removeVector(id)
        }
        await vectorStore.save()
      } catch (error) {
        logger.warn('[MemoryDedup] Failed to clean up vector store', {
          context: 'memory-dedup.deduplicateCharacterMemories',
          characterId,
          error: String(error),
        })
      }
    }
  }

  return {
    characterId,
    characterName,
    originalCount,
    withEmbeddings: withEmbeddings.length,
    withoutEmbeddings: withoutEmbeddings.length,
    clustersFound: allClusters.length,
    memoriesInClusters: allClusters.reduce((sum, c) => sum + c.size, 0),
    removedCount,
    mergedDetailCount: totalMergedDetails,
    finalCount,
    clusters: allClusters,
  }
}

// =============================================================================
// All Characters Deduplication
// =============================================================================

/**
 * Deduplicate memories across all characters for a user.
 */
export async function deduplicateAllMemories(
  userId: string,
  threshold: number,
  dryRun: boolean
): Promise<DedupResult> {
  logger.info('[MemoryDedup] Starting deduplication for all characters', {
    context: 'memory-dedup.deduplicateAllMemories',
    userId,
    threshold,
    dryRun,
  })

  const userRepos = getUserRepositories(userId)
  const characters = await userRepos.characters.findAll()

  const characterResults: CharacterDedupResult[] = []
  let totalOriginal = 0
  let totalRemoved = 0
  let totalMergedDetails = 0

  for (const character of characters) {
    try {
      const result = await deduplicateCharacterMemories(
        character.id,
        character.name,
        threshold,
        dryRun
      )
      characterResults.push(result)
      totalOriginal += result.originalCount
      totalRemoved += result.removedCount
      totalMergedDetails += result.mergedDetailCount
    } catch (error) {
      logger.error('[MemoryDedup] Failed to deduplicate character', {
        context: 'memory-dedup.deduplicateAllMemories',
        characterId: character.id,
        characterName: character.name,
        error: error instanceof Error ? error.message : String(error),
      }, error instanceof Error ? error : undefined)

      // Add a zero-result entry so the character still appears in results
      characterResults.push({
        characterId: character.id,
        characterName: character.name,
        originalCount: 0,
        withEmbeddings: 0,
        withoutEmbeddings: 0,
        clustersFound: 0,
        memoriesInClusters: 0,
        removedCount: 0,
        mergedDetailCount: 0,
        finalCount: 0,
        clusters: [],
      })
    }
  }

  const totalFinal = totalOriginal - totalRemoved

  logger.info('[MemoryDedup] Deduplication complete', {
    context: 'memory-dedup.deduplicateAllMemories',
    userId,
    characterCount: characters.length,
    totalOriginal,
    totalRemoved,
    totalMergedDetails,
    totalFinal,
    dryRun,
  })

  return {
    threshold,
    dryRun,
    characters: characterResults,
    totalOriginal,
    totalRemoved,
    totalMergedDetails,
    totalFinal,
    processedAt: new Date().toISOString(),
  }
}
