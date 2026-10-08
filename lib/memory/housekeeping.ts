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
import { calculateEffectiveWeight, calculateProtectionScore } from './memory-weighting'
import { deleteMemoriesWithUnlinkBatch } from './memory-gate'
import { getMemoryConsolidationSettings } from '@/lib/instance-settings'
import { invalidateFrozenArchive } from './frozen-archive-cache'

import { logger } from '@/lib/logger'

/**
 * Protection score below which a memory is a deletion candidate.
 * Memories above this threshold are preserved by the housekeeping gate.
 */
const PROTECTION_THRESHOLD = 0.5

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
  /** Retired in favour of consolidation: accepted, ignored (default: false) */
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
  /** Number of memories deleted (retention sweep only: expired, superseded cold rows) */
  deleted: number
  /** Number of hot memories moved to the cold tier */
  demoted: number
  /** Retired: always 0. Kept so older callers keep reading a number. */
  merged: number
  /** Number of memories kept */
  kept: number
  /** Hot memories before the sweep (the number the cap is measured against) */
  totalBefore: number
  /** Hot memories after the sweep */
  totalAfter: number
  /** Cold (archived) memories the character holds, untouched by demotion */
  coldCount: number
  /** The effective cap used for this sweep — either the per-character
   * override, the user's global cap, or the housekeeping default. Returned
   * so callers (e.g. the outcome cache) can evaluate effectiveness
   * against a specific target size rather than re-resolving the cap. */
  capUsed: number
  /** IDs of deleted memories */
  deletedIds: string[]
  /** IDs of memories moved to the cold tier */
  demotedIds: string[]
  /** Retired: always empty */
  mergedIds: string[]
  /** Reasons for each demotion/deletion */
  details: HousekeepingDetail[]
}

/**
 * Detail of a single housekeeping action
 */
export interface HousekeepingDetail {
  memoryId: string
  action: 'deleted' | 'demoted' | 'merged' | 'kept'
  reason: string
  summary?: string
}

/**
 * Default housekeeping options based on PLAN.md retention policy
 */
const DEFAULT_OPTIONS: Required<Omit<HousekeepingOptions, 'userId' | 'embeddingProfileId'>> = {
  maxMemories: 2000,
  maxAgeMonths: 6,
  maxInactiveMonths: 6,
  minImportance: 0.3,
  mergeSimilar: false,
  mergeThreshold: 0.9,
  dryRun: false,
}

/**
 * Check if a memory is protected from deletion.
 *
 * Protection is determined by a blended score that combines the LLM-derived
 * content importance (time-decayed) with observed usage evidence — reinforcement
 * count, graph degree (related-memory links), and recent access. This replaces
 * the earlier four-rule gate, which relied on raw LLM importance as a bright
 * line and effectively made 99% of memories immortal when the cheap-LLM scorer
 * clustered all its outputs in the 0.7–0.9 band.
 *
 * `source === 'MANUAL'` remains a hard override — explicit user intent is
 * treated as durable regardless of what the signals say.
 *
 * See `calculateProtectionScore` in memory-weighting.ts for the full formula.
 */
function isProtectedMemory(memory: Memory, now: Date): boolean {
  // MANUAL is explicit user intent; CONSOLIDATED digests are the surviving
  // record of their archived members. Neither is ever demoted by policy.
  if (memory.source === 'MANUAL' || memory.source === 'CONSOLIDATED') {
    return true
  }
  const { score } = calculateProtectionScore(memory, undefined, now)
  return score >= PROTECTION_THRESHOLD
}

/**
 * Check if a memory should be deleted based on retention policy
 */
function shouldDeleteMemory(
  memory: Memory,
  now: Date,
  options: Required<Omit<HousekeepingOptions, 'userId' | 'embeddingProfileId'>>,
  isProtected: boolean
): { shouldDelete: boolean; reason: string } {
  if (isProtected) {
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
 * Housekeeping keeps the HOT tier within its cap by moving the least valuable
 * rows to the COLD tier (the archive). It never destroys history by policy:
 * the only deletion is the retention sweep, which removes cold rows that a
 * digest has superseded once they are older than
 * `memoryConsolidation.coldRetentionDays` (default: never).
 *
 * - Pass 1 demotes low-importance, old, inactive rows.
 * - Pass 2 (`mergeSimilar`) is retired in favour of consolidation; the option is
 *   still accepted for back-compat but does nothing.
 * - Pass 3 demotes the lowest-weighted unprotected rows until the hot tier
 *   fits the cap.
 * - Retention deletes expired, superseded, cold AUTO rows.
 *
 * MANUAL rows and CONSOLIDATED digests are never demoted or deleted here.
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

  // Load memories in pages so a character with tens of thousands of entries
  // doesn't block the event loop on a single synchronous Zod-validated read.
  // Each page is ~1 encrypted SELECT + ~N row-validations; yielding between
  // pages lets HTTP, heartbeats, and other jobs make progress. Batch size 250
  // keeps each synchronous chunk small enough (~50–150 ms of Zod work) that
  // Next.js dev-server request handling doesn't starve during a sweep.
  const LOAD_BATCH_SIZE = 250
  const allMemories: Memory[] = []
  for await (const batch of repos.memories.findByCharacterIdInBatches(characterId, LOAD_BATCH_SIZE)) {
    for (const memory of batch) allMemories.push(memory)
    await new Promise<void>(resolve => setImmediate(resolve))
  }
  // The cap, the passes and the counts below all speak of the hot tier; cold
  // rows are the archive and are only touched by the retention sweep.
  const memories = allMemories.filter(m => m.tier !== 'cold')
  const coldCount = allMemories.length - memories.length
  const totalBefore = memories.length

  const result: HousekeepingResult = {
    deleted: 0,
    demoted: 0,
    merged: 0,
    kept: 0,
    totalBefore,
    totalAfter: totalBefore,
    coldCount,
    capUsed: opts.maxMemories,
    deletedIds: [],
    demotedIds: [],
    mergedIds: [],
    details: [],
  }

  logger.debug('[Housekeeping] Starting sweep', {
    characterId,
    hot: totalBefore,
    cold: coldCount,
    cap: opts.maxMemories,
    dryRun: opts.dryRun,
  })

  if (opts.mergeSimilar) {
    logger.debug('[Housekeeping] mergeSimilar is retired in favour of consolidation; skipping the merge pass', {
      characterId,
    })
  }

  const demoteSet = new Set<string>()

  if (memories.length > 0) {
    // Sort memories by importance (descending) then by creation date (ascending)
    // This ensures we keep the most important and newest memories
    const sortedMemories = [...memories].sort((a, b) => {
      if (b.importance !== a.importance) {
        return b.importance - a.importance
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })

    // Protection is expensive to compute (blended multi-signal score).
    // Cache pass-1 results so the cap-enforcement pass can reuse them.
    const protectedMap = new Map<string, boolean>()

    // Yield to the event loop every YIELD_INTERVAL items in the two big loops so
    // a 19k-memory character doesn't block HTTP and other jobs.
    const YIELD_INTERVAL = 500
    const yieldTick = () => new Promise<void>(resolve => setImmediate(resolve))

    // First pass: identify memories to demote based on retention policy
    for (let i = 0; i < sortedMemories.length; i++) {
      const memory = sortedMemories[i]
      const isProtected = isProtectedMemory(memory, now)
      protectedMap.set(memory.id, isProtected)

      const { shouldDelete: shouldDemote, reason } = shouldDeleteMemory(memory, now, opts, isProtected)

      if (shouldDemote) {
        demoteSet.add(memory.id)
        result.details.push({
          memoryId: memory.id,
          action: 'demoted',
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

      if ((i + 1) % YIELD_INTERVAL === 0) {
        await yieldTick()
      }
    }

    // Third pass: enforce the hot-tier cap if still over limit.
    //
    // If every remaining memory is protected, the demotion loop below would
    // skip every candidate and score + sort 19k entries for nothing. Do a
    // cheap pre-check first: when no unprotected-and-undemoted memory exists,
    // skip the entire scoring pass.
    const remainingAfterDemotion = memories.filter(m => !demoteSet.has(m.id))
    const hasDemotionCandidate =
      remainingAfterDemotion.length > opts.maxMemories &&
      remainingAfterDemotion.some(m => !(protectedMap.get(m.id) ?? isProtectedMemory(m, now)))
    if (hasDemotionCandidate) {
      const scoredMemories = remainingAfterDemotion.map(m => {
        const { effectiveWeight } = calculateEffectiveWeight(m, undefined, now)
        return { memory: m, score: effectiveWeight }
      })

      scoredMemories.sort((a, b) => b.score - a.score)

      const excessCount = remainingAfterDemotion.length - opts.maxMemories
      let demotedForLimit = 0
      let iterations = 0

      for (let i = scoredMemories.length - 1; i >= 0 && demotedForLimit < excessCount; i--) {
        const { memory } = scoredMemories[i]

        if (demoteSet.has(memory.id)) continue
        // Reuse protection result from pass 1 instead of recomputing.
        const isProtected = protectedMap.get(memory.id) ?? isProtectedMemory(memory, now)
        if (isProtected) continue

        demoteSet.add(memory.id)
        const existing = result.details.find(d => d.memoryId === memory.id)
        if (existing) {
          existing.action = 'demoted'
          existing.reason = `Exceeded hot-memory limit (${opts.maxMemories})`
        } else {
          result.details.push({
            memoryId: memory.id,
            action: 'demoted',
            reason: `Exceeded hot-memory limit (${opts.maxMemories})`,
            summary: memory.summary,
          })
        }
        demotedForLimit++
        iterations++

        if (iterations % YIELD_INTERVAL === 0) {
          await yieldTick()
        }
      }
    }
  }

  const demotedIds = Array.from(demoteSet)

  // Retention: the only deletion. Cold, superseded AUTO rows past the window.
  let expiredIds: string[] = []
  const retentionDays = (await getMemoryConsolidationSettings()).coldRetentionDays
  if (retentionDays !== null && retentionDays !== undefined && retentionDays > 0) {
    const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString()
    expiredIds = await repos.memories.findExpiredColdIds(characterId, cutoff)
    for (const id of expiredIds) {
      result.details.push({
        memoryId: id,
        action: 'deleted',
        reason: `Superseded archive row older than the ${retentionDays}-day retention window`,
      })
    }
  }

  let vectorStoreDirty = false
  if (!opts.dryRun && demotedIds.length > 0) {
    await repos.memories.updateTierBulk(characterId, demotedIds, 'cold')
    try {
      const vectorStore = await getCharacterVectorStore(characterId)
      vectorStore.setTier(demotedIds, 'cold')
    } catch (error) {
      logger.warn('[Housekeeping] Failed to re-stamp vector tier after demotion', {
        characterId,
        error: String(error),
      })
    }
    result.demoted = demotedIds.length
    result.demotedIds = demotedIds
    vectorStoreDirty = true
  } else if (opts.dryRun) {
    result.demoted = demotedIds.length
    result.demotedIds = demotedIds
  }

  if (!opts.dryRun && expiredIds.length > 0) {
    const deletedCount = await deleteMemoriesWithUnlinkBatch(expiredIds)

    try {
      const vectorStore = await getCharacterVectorStore(characterId)
      for (const id of expiredIds) {
        await vectorStore.removeVector(id)
      }
      await vectorStore.save()
    } catch (error) {
      logger.warn(`[Housekeeping] Failed to clean up vector store`, { characterId, error: String(error) })
    }
    result.deleted = deletedCount
    result.deletedIds = expiredIds
    vectorStoreDirty = true
  } else if (opts.dryRun) {
    result.deleted = expiredIds.length
    result.deletedIds = expiredIds
  }

  if (vectorStoreDirty) {
    // The corpus just changed under every cached archive for this character.
    // In the parent (the Memories API path) this drops the cache directly; in
    // the job child it is a no-op on the child's own map, and the parent's
    // job-completion hook does the real invalidation.
    invalidateFrozenArchive(characterId)
  }

  result.kept = totalBefore - demotedIds.length
  result.totalAfter = result.kept

  logger.debug('[Housekeeping] Sweep computed', {
    characterId,
    dryRun: opts.dryRun,
    demoted: result.demoted,
    deleted: result.deleted,
    hotAfter: result.totalAfter,
  })

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
 * - Hot memory count exceeds 80% of the limit
 * - There are memories matching demotion or retention criteria
 */
export async function needsHousekeeping(
  characterId: string,
  options: Omit<HousekeepingOptions, 'dryRun'> = {}
): Promise<boolean> {
  const repos = getRepositories()
  const maxMemories = options.maxMemories ?? DEFAULT_OPTIONS.maxMemories

  // Quick check: memory count
  const count = await repos.memories.countHotByCharacterId(characterId)
  if (count >= maxMemories * 0.8) {
    return true
  }

  // More thorough check: preview housekeeping
  if (count > 0) {
    const preview = await getHousekeepingPreview(characterId, options)
    return preview.demoted + preview.deleted > 0
  }

  return false
}
