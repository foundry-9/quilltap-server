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
import { memoryIndex } from './index-store'
import { filterImportance, protection } from './scoring'
import { MEMORY_SETTING_DEFAULTS } from './settings-defaults'
import { retireMemories } from './retire'
import { getMemoryConsolidationSettings } from '@/lib/instance-settings'
import { invalidateFrozenArchive } from './recall/archive'

import { logger } from '@/lib/logger'

/**
 * Housekeeping options for memory cleanup
 */
export interface HousekeepingOptions {
  /** Cap on demotable (hot AUTO) memories (default: the maintenance schema's `perCharacterCap`, 2000) */
  maxMemories?: number
  /** Delete memories older than this many months if not important (default: 6) */
  maxAgeMonths?: number
  /** Delete memories not accessed in this many months (default: 6) */
  maxInactiveMonths?: number
  /** Delete memories below this importance threshold (default: 0.3) */
  minImportance?: number
  /** Preview changes without applying (default: false) */
  dryRun?: boolean
}

/**
 * Result of a housekeeping operation
 */
export interface HousekeepingResult {
  /** Number of memories deleted (retention sweep only: expired, superseded cold rows) */
  deleted: number
  /** Number of hot memories moved to the cold tier */
  demoted: number
  /** Number of memories kept */
  kept: number
  /** Hot memories before the sweep (demotable + protected) */
  totalBefore: number
  /** Hot memories before the sweep — same as `totalBefore`, named for the report (bug 210) */
  hotTotal: number
  /**
   * Demotable memories before the sweep — hot AUTO rows. The cap is measured
   * against this number only (bug 210, locked decision 3).
   */
  demotable: number
  /** Hot MANUAL rows and CONSOLIDATED digests: never demoted, never counted against the cap */
  protected: number
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
  /** Reasons for each demotion/deletion */
  details: HousekeepingDetail[]
}

/**
 * Detail of a single housekeeping action
 */
export interface HousekeepingDetail {
  memoryId: string
  action: 'deleted' | 'demoted' | 'kept'
  reason: string
  summary?: string
}

/**
 * Default housekeeping options based on PLAN.md retention policy
 */
const DEFAULT_OPTIONS: Required<HousekeepingOptions> = {
  maxMemories: MEMORY_SETTING_DEFAULTS.maintenance.perCharacterCap,
  maxAgeMonths: 6,
  maxInactiveMonths: 6,
  minImportance: 0.3,
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
 * See `protection` in `lib/memory/scoring` for the full formula; it also
 * reports MANUAL rows and CONSOLIDATED digests as protected.
 */
function isProtectedMemory(memory: Memory, now: Date): boolean {
  return protection(memory, { nowMs: now.getTime() }).protected
}

/**
 * True for the rows the cap measures and may demote: AUTO rows. MANUAL rows
 * and CONSOLIDATED digests are never demoted by policy, so counting them
 * against the cap made it unreachable on a mature character (bug 210).
 * Callers pass hot rows; tier is checked by the caller.
 */
function isDemotableSource(memory: Pick<Memory, 'source'>): boolean {
  return memory.source === 'AUTO'
}

/**
 * Check if a memory should be deleted based on retention policy
 */
function shouldDeleteMemory(
  memory: Memory,
  now: Date,
  options: Required<HousekeepingOptions>,
  isProtected: boolean
): { shouldDelete: boolean; reason: string } {
  if (isProtected) {
    return { shouldDelete: false, reason: 'protected' }
  }

  // reinforcedImportance (falling back to importance), as every importance filter reads it
  const importanceForFilter = filterImportance(memory)
  if (importanceForFilter < options.minImportance) {
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
 * - (The old merge-similar pass is gone; consolidation combines rows.)
 * - Pass 3 demotes demotable rows (hot AUTO), lowest protection score first,
 *   until they fit the cap. MANUAL rows and digests never count against the
 *   cap (bug 210).
 * - Retention deletes expired, superseded, cold AUTO rows.
 *
 * A demoted row goes cold with no `supersededById`. Consolidation takes such
 * rows as candidates alongside the hot tier (bug 211), so a demoted row's gist
 * reaches a digest, it becomes superseded, and retention can retire it.
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
  // The cap counts demotable rows only (bug 210): hot AUTO rows. MANUAL rows
  // and digests stay hot whatever the cap says, so they are reported apart.
  const demotableBefore = memories.filter(isDemotableSource).length
  const protectedCount = totalBefore - demotableBefore

  const result: HousekeepingResult = {
    deleted: 0,
    demoted: 0,
    kept: 0,
    totalBefore,
    totalAfter: totalBefore,
    hotTotal: totalBefore,
    demotable: demotableBefore,
    protected: protectedCount,
    coldCount,
    capUsed: opts.maxMemories,
    deletedIds: [],
    demotedIds: [],
    details: [],
  }

  logger.debug('[Housekeeping] Starting sweep', {
    characterId,
    hot: totalBefore,
    demotable: demotableBefore,
    protected: protectedCount,
    cold: coldCount,
    cap: opts.maxMemories,
    dryRun: opts.dryRun,
  })

  const demoteSet = new Set<string>()

  if (memories.length > 0) {
    // Visit memories by reinforced importance (descending), then newest first.
    // Each row is decided on its own, so this only orders the report.
    const sortedMemories = [...memories].sort((a, b) => {
      const ia = filterImportance(a)
      const ib = filterImportance(b)
      if (ib !== ia) {
        return ib - ia
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })

    // Details by id, so the cap pass can re-label a pass-1 "kept" row.
    const detailById = new Map<string, HousekeepingDetail>()

    // Yield to the event loop every YIELD_INTERVAL items in the two big loops so
    // a 19k-memory character doesn't block HTTP and other jobs.
    const YIELD_INTERVAL = 500
    const yieldTick = () => new Promise<void>(resolve => setImmediate(resolve))

    // First pass: identify memories to demote based on retention policy
    for (let i = 0; i < sortedMemories.length; i++) {
      const memory = sortedMemories[i]
      const isProtected = isProtectedMemory(memory, now)

      const { shouldDelete: shouldDemote, reason } = shouldDeleteMemory(memory, now, opts, isProtected)

      if (shouldDemote) demoteSet.add(memory.id)
      const detail: HousekeepingDetail = {
        memoryId: memory.id,
        action: shouldDemote ? 'demoted' : 'kept',
        reason,
        summary: memory.summary,
      }
      result.details.push(detail)
      detailById.set(memory.id, detail)

      if ((i + 1) % YIELD_INTERVAL === 0) {
        await yieldTick()
      }
    }

    // Third pass: enforce the cap over the demotable rows (bug 210).
    //
    // The cap measures hot AUTO rows only; MANUAL rows and digests are never
    // demoted, so counting them made the cap unreachable once they alone
    // passed it. When demotable rows still exceed the cap after pass 1, the
    // excess goes cold lowest protection first — the same score that decides
    // whether a row may go in pass 1 decides which goes first here, so a
    // well-reinforced, well-linked row outlasts a stale one.
    const remainingDemotable = memories.filter(m => isDemotableSource(m) && !demoteSet.has(m.id))
    const excessCount = remainingDemotable.length - opts.maxMemories
    if (excessCount > 0) {
      const scored: Array<{ memory: Memory; score: number }> = []
      for (let i = 0; i < remainingDemotable.length; i++) {
        const memory = remainingDemotable[i]
        const { score } = protection(memory, { nowMs: now.getTime() })
        scored.push({ memory, score })
        if ((i + 1) % YIELD_INTERVAL === 0) {
          await yieldTick()
        }
      }
      scored.sort((a, b) =>
        a.score !== b.score
          ? a.score - b.score
          : new Date(a.memory.createdAt).getTime() - new Date(b.memory.createdAt).getTime(),
      )

      const reason = `Exceeded demotable-memory limit (${opts.maxMemories})`
      for (let i = 0; i < excessCount; i++) {
        const { memory } = scored[i]
        demoteSet.add(memory.id)
        const existing = detailById.get(memory.id)
        if (existing) {
          existing.action = 'demoted'
          existing.reason = reason
        } else {
          const detail: HousekeepingDetail = { memoryId: memory.id, action: 'demoted', reason, summary: memory.summary }
          result.details.push(detail)
          detailById.set(memory.id, detail)
        }
      }
      logger.debug('[Housekeeping] Cap pass demoted the excess, lowest protection first', {
        characterId,
        cap: opts.maxMemories,
        demotableRemaining: remainingDemotable.length,
        demotedForCap: excessCount,
        highestScoreDemoted: scored[excessCount - 1]?.score,
      })
    } else {
      logger.debug('[Housekeeping] Demotable rows within the cap; no cap demotion', {
        characterId,
        cap: opts.maxMemories,
        demotableRemaining: remainingDemotable.length,
        protected: protectedCount,
      })
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
    await memoryIndex.setTier(characterId, demotedIds, 'cold')
    result.demoted = demotedIds.length
    result.demotedIds = demotedIds
    vectorStoreDirty = true
  } else if (opts.dryRun) {
    result.demoted = demotedIds.length
    result.demotedIds = demotedIds
  }

  if (!opts.dryRun && expiredIds.length > 0) {
    // The deletion chokepoint scrubs links and evicts the rows' vectors too.
    // Retention never takes a digest with its last member: outliving the
    // members it replaced is the digest's purpose.
    const deletedCount = (await retireMemories(expiredIds, { reason: 'retention' })).retired
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
    demotableAfter: demotableBefore - demotedIds.length,
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
