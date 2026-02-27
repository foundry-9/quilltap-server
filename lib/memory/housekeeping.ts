/**
 * Memory Housekeeping Service
 * Sprint 6: Automatic cleanup and maintenance of character memories
 *
 * Implements retention policies based on:
 * - Importance scoring (0-1)
 * - Age of memory (months since creation)
 * - Access time (months since last accessed)
 * - Memory count limits per character
 */

import { getRepositories } from '@/lib/repositories/factory'
import { Memory } from '@/lib/schemas/types'
import { getCharacterVectorStore } from '@/lib/embedding/vector-store'

import { logger } from '@/lib/logger'

/**
 * Housekeeping options for memory cleanup
 */
export interface HousekeepingOptions {
  /** Maximum number of memories to keep (default: 1000) */
  maxMemories?: number
  /** Delete memories older than this many months if not important (default: 6) */
  maxAgeMonths?: number
  /** Delete memories not accessed in this many months (default: 6) */
  maxInactiveMonths?: number
  /** Delete memories below this importance threshold (default: 0.3) */
  minImportance?: number
  /** Merge semantically similar memories (default: false) */
  mergeSimilar?: boolean
  /** Similarity threshold for merging (default: 0.9) */
  mergeThreshold?: number
  /** Preview changes without applying (default: false) */
  dryRun?: boolean
  /** User ID for embedding operations (required for merge) */
  userId?: string
  /** Embedding profile ID */
  embeddingProfileId?: string
}

/**
 * Result of a housekeeping operation
 */
export interface HousekeepingResult {
  /** Number of memories deleted */
  deleted: number
  /** Number of memories merged */
  merged: number
  /** Number of memories kept */
  kept: number
  /** Total memories before cleanup */
  totalBefore: number
  /** Total memories after cleanup */
  totalAfter: number
  /** IDs of deleted memories */
  deletedIds: string[]
  /** IDs of merged memories (source memories that were merged into others) */
  mergedIds: string[]
  /** Reasons for each deletion/merge */
  details: HousekeepingDetail[]
}

/**
 * Detail of a single housekeeping action
 */
export interface HousekeepingDetail {
  memoryId: string
  action: 'deleted' | 'merged' | 'kept'
  reason: string
  summary?: string
}

/**
 * Default housekeeping options based on PLAN.md retention policy
 */
const DEFAULT_OPTIONS: Required<Omit<HousekeepingOptions, 'userId' | 'embeddingProfileId'>> = {
  maxMemories: 1000,
  maxAgeMonths: 6,
  maxInactiveMonths: 6,
  minImportance: 0.3,
  mergeSimilar: false,
  mergeThreshold: 0.9,
  dryRun: false,
}

/**
 * Check if a memory is protected from deletion
 *
 * Protected memories:
 * - Importance >= 0.7 (high importance)
 * - Manually created (source === 'MANUAL')
 * - Accessed within the last 3 months
 */
function isProtectedMemory(memory: Memory, now: Date): boolean {
  // Use reinforcedImportance (falling back to importance) for the threshold
  const effectiveImportance = memory.reinforcedImportance ?? memory.importance

  // High importance memories are always protected
  if (effectiveImportance >= 0.7) {
    return true
  }

  // Memories with high reinforcement count are stable knowledge — always protected
  if ((memory.reinforcementCount ?? 1) >= 5) {
    return true
  }

  // Manually created memories are protected
  if (memory.source === 'MANUAL') {
    return true
  }

  // Recently accessed memories are protected (3 months)
  if (memory.lastAccessedAt) {
    const lastAccessed = new Date(memory.lastAccessedAt)
    const monthsInactive = (now.getTime() - lastAccessed.getTime()) / (1000 * 60 * 60 * 24 * 30)
    if (monthsInactive < 3) {
      return true
    }
  }

  return false
}

/**
 * Check if a memory should be deleted based on retention policy
 */
function shouldDeleteMemory(
  memory: Memory,
  now: Date,
  options: Required<Omit<HousekeepingOptions, 'userId' | 'embeddingProfileId'>>
): { shouldDelete: boolean; reason: string } {
  // Never delete protected memories
  if (isProtectedMemory(memory, now)) {
    return { shouldDelete: false, reason: 'protected' }
  }

  // Use reinforcedImportance for threshold checks (falls back to importance for old memories)
  const effectiveImportance = memory.reinforcedImportance ?? memory.importance
  if (effectiveImportance < options.minImportance) {
    const createdAt = new Date(memory.createdAt)
    const ageMonths = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24 * 30)

    // Only delete low importance if also old
    if (ageMonths >= options.maxAgeMonths) {
      // Check if not accessed recently
      if (!memory.lastAccessedAt) {
        return {
          shouldDelete: true,
          reason: `Low importance (${(memory.importance * 100).toFixed(0)}%) and old (${ageMonths.toFixed(1)} months)`,
        }
      }

      const lastAccessed = new Date(memory.lastAccessedAt)
      const inactiveMonths = (now.getTime() - lastAccessed.getTime()) / (1000 * 60 * 60 * 24 * 30)

      if (inactiveMonths >= options.maxInactiveMonths) {
        return {
          shouldDelete: true,
          reason: `Low importance (${(memory.importance * 100).toFixed(0)}%), old (${ageMonths.toFixed(1)} months), and inactive (${inactiveMonths.toFixed(1)} months)`,
        }
      }
    }
  }

  return { shouldDelete: false, reason: 'within retention policy' }
}

/**
 * Run housekeeping on a character's memories
 *
 * This function cleans up old, low-importance, and duplicate memories
 * based on the configured retention policy.
 */
export async function runHousekeeping(
  characterId: string,
  options: HousekeepingOptions = {}
): Promise<HousekeepingResult> {
  const repos = getRepositories()
  const now = new Date()

  // Merge options with defaults
  const opts = {
    ...DEFAULT_OPTIONS,
    ...options,
  }

  // Get all memories for this character
  const memories = await repos.memories.findByCharacterId(characterId)
  const totalBefore = memories.length

  const result: HousekeepingResult = {
    deleted: 0,
    merged: 0,
    kept: 0,
    totalBefore,
    totalAfter: totalBefore,
    deletedIds: [],
    mergedIds: [],
    details: [],
  }

  if (memories.length === 0) {
    return result
  }

  // Sort memories by importance (descending) then by creation date (ascending)
  // This ensures we keep the most important and newest memories
  const sortedMemories = [...memories].sort((a, b) => {
    if (b.importance !== a.importance) {
      return b.importance - a.importance
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

  const memoriesToDelete: string[] = []
  const memoriesToMerge: { sourceId: string; targetId: string }[] = []

  // First pass: identify memories to delete based on retention policy
  for (const memory of sortedMemories) {
    const { shouldDelete, reason } = shouldDeleteMemory(memory, now, opts)

    if (shouldDelete) {
      memoriesToDelete.push(memory.id)
      result.details.push({
        memoryId: memory.id,
        action: 'deleted',
        reason,
        summary: memory.summary,
      })
    } else {
      result.details.push({
        memoryId: memory.id,
        action: 'kept',
        reason,
        summary: memory.summary,
      })
    }
  }

  // Second pass: check for duplicates/similar memories if merge is enabled
  // Uses already-stored embeddings from the vector store — no API calls needed.
  if (opts.mergeSimilar) {
    const remainingMemories = sortedMemories.filter(m => !memoriesToDelete.includes(m.id))
    const memoryMap = new Map(remainingMemories.map(m => [m.id, m]))
    const deleteSet = new Set(memoriesToDelete)

    try {
      const vectorStore = await getCharacterVectorStore(characterId)

      for (let i = 0; i < remainingMemories.length; i++) {
        const memory = remainingMemories[i]

        // Skip if already marked for deletion/merge
        if (deleteSet.has(memory.id)) {
          continue
        }

        // Use the stored embedding from the vector store (no API call)
        const entry = vectorStore.getAllEntries().find(e => e.id === memory.id)
        if (!entry) {
          continue
        }

        // Search for similar using the existing embedding
        const searchResults = vectorStore.search(entry.embedding, 10)

        for (const match of searchResults) {
          if (match.id === memory.id) continue
          if (match.score < opts.mergeThreshold) continue
          if (deleteSet.has(match.id)) continue
          if (memoriesToMerge.some(m => m.sourceId === match.id)) continue

          const matchMemory = memoryMap.get(match.id)
          if (!matchMemory) continue

          // Determine which to keep (higher importance or newer if equal)
          const keepCurrent =
            memory.importance > matchMemory.importance ||
            (memory.importance === matchMemory.importance &&
              new Date(memory.createdAt) > new Date(matchMemory.createdAt))

          if (keepCurrent) {
            memoriesToMerge.push({
              sourceId: matchMemory.id,
              targetId: memory.id,
            })
            memoriesToDelete.push(matchMemory.id)
            deleteSet.add(matchMemory.id)
            result.details.push({
              memoryId: matchMemory.id,
              action: 'merged',
              reason: `Similar to memory ${memory.id} (${(match.score * 100).toFixed(0)}% similarity)`,
              summary: matchMemory.summary,
            })
          } else {
            memoriesToMerge.push({
              sourceId: memory.id,
              targetId: matchMemory.id,
            })
            memoriesToDelete.push(memory.id)
            deleteSet.add(memory.id)
            result.details.push({
              memoryId: memory.id,
              action: 'merged',
              reason: `Similar to memory ${matchMemory.id} (${(match.score * 100).toFixed(0)}% similarity)`,
              summary: memory.summary,
            })
            break // This memory is being merged, stop checking for its duplicates
          }
        }
      }
    } catch (error) {
      logger.warn('[Housekeeping] Failed to run similarity merge pass', { characterId, error: String(error) })
    }
  }

  // Third pass: enforce hard cap if still over limit
  const remainingAfterDeletion = memories.filter(m => !memoriesToDelete.includes(m.id))
  if (remainingAfterDeletion.length > opts.maxMemories) {
    // Sort by score (importance * recency factor)
    const scoredMemories = remainingAfterDeletion.map(m => {
      const ageMonths = (now.getTime() - new Date(m.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 30)
      const recencyFactor = Math.max(0.1, 1 - (ageMonths / 12)) // Decays over a year
      const accessFactor = m.lastAccessedAt
        ? Math.max(0.1, 1 - ((now.getTime() - new Date(m.lastAccessedAt).getTime()) / (1000 * 60 * 60 * 24 * 90))) // 3 months
        : 0.5
      // Use reinforcedImportance and add reinforcement factor
      const effectiveImportance = m.reinforcedImportance ?? m.importance
      const reinforcementFactor = Math.min(1.0, Math.log2(((m.reinforcementCount ?? 1)) + 1) * 0.15)
      const score = effectiveImportance * 0.4 + recencyFactor * 0.2 + accessFactor * 0.2 + reinforcementFactor * 0.2
      return { memory: m, score }
    })

    scoredMemories.sort((a, b) => b.score - a.score)

    // Mark excess memories for deletion (keeping protected ones)
    const excessCount = remainingAfterDeletion.length - opts.maxMemories
    let deletedForLimit = 0

    for (let i = scoredMemories.length - 1; i >= 0 && deletedForLimit < excessCount; i--) {
      const { memory } = scoredMemories[i]

      // Skip if already marked for deletion or protected
      if (memoriesToDelete.includes(memory.id)) continue
      if (isProtectedMemory(memory, now)) continue

      memoriesToDelete.push(memory.id)
      result.details.push({
        memoryId: memory.id,
        action: 'deleted',
        reason: `Exceeded memory limit (${opts.maxMemories})`,
        summary: memory.summary,
      })
      deletedForLimit++
    }
  }

  // Apply changes if not a dry run
  if (!opts.dryRun && memoriesToDelete.length > 0) {
    // Delete memories from repository
    const deletedCount = await repos.memories.bulkDelete(characterId, memoriesToDelete)

    // Remove from vector store
    try {
      const vectorStore = await getCharacterVectorStore(characterId)
      for (const id of memoriesToDelete) {
        await vectorStore.removeVector(id)
      }
      await vectorStore.save()
    } catch (error) {
      logger.warn(`[Housekeeping] Failed to clean up vector store`, { characterId, error: String(error) })
    }

    result.deleted = deletedCount
    result.merged = memoriesToMerge.length
    result.deletedIds = memoriesToDelete
    result.mergedIds = memoriesToMerge.map(m => m.sourceId)
  } else if (opts.dryRun) {
    result.deleted = memoriesToDelete.length
    result.merged = memoriesToMerge.length
    result.deletedIds = memoriesToDelete
    result.mergedIds = memoriesToMerge.map(m => m.sourceId)
  }

  result.kept = totalBefore - memoriesToDelete.length
  result.totalAfter = result.kept

  return result
}

/**
 * Get housekeeping statistics for a character without making changes
 */
export async function getHousekeepingPreview(
  characterId: string,
  options: HousekeepingOptions = {}
): Promise<HousekeepingResult> {
  return runHousekeeping(characterId, { ...options, dryRun: true })
}

/**
 * Check if housekeeping is needed for a character
 *
 * Returns true if:
 * - Memory count exceeds 80% of the limit
 * - There are memories matching deletion criteria
 */
export async function needsHousekeeping(
  characterId: string,
  options: Omit<HousekeepingOptions, 'dryRun'> = {}
): Promise<boolean> {
  const repos = getRepositories()
  const maxMemories = options.maxMemories ?? DEFAULT_OPTIONS.maxMemories

  // Quick check: memory count
  const count = await repos.memories.countByCharacterId(characterId)
  if (count >= maxMemories * 0.8) {
    return true
  }

  // More thorough check: preview housekeeping
  if (count > 0) {
    const preview = await getHousekeepingPreview(characterId, options)
    return preview.deleted > 0
  }

  return false
}
