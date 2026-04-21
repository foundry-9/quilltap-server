/**
 * Memory Weighting Module
 *
 * Provides a unified effective weight calculation for memories that combines
 * base importance with exponential time decay and a configurable importance floor.
 * Used across retrieval ranking, context injection, and housekeeping.
 */

import type { Memory } from '@/lib/schemas/types'
import { logger } from '@/lib/logger'

/**
 * Configuration for memory weight calculations.
 */
export interface MemoryWeightingConfig {
  /** Number of days for the decay factor to reach 0.5. Default: 30 */
  halfLifeDays: number
  /** Minimum fraction of importance that weight can decay to. Default: 0.70 */
  importanceFloor: number
  /** Memories with effective weight below this are candidates for filtering. Default: 0.05 */
  minWeightThreshold: number
}

export const DEFAULT_WEIGHTING_CONFIG: MemoryWeightingConfig = {
  halfLifeDays: 30,
  importanceFloor: 0.70,
  minWeightThreshold: 0.05,
}

export interface EffectiveWeightResult {
  effectiveWeight: number
  rawWeight: number
  minWeight: number
  timeDecayFactor: number
  daysOld: number
  baseImportance: number
}

/**
 * Calculate the effective weight of a memory combining importance with time decay.
 *
 * Formula:
 *   daysOld = (now - max(createdAt, lastReinforcedAt)) / 86400000
 *   timeDecayFactor = 0.5 ^ (daysOld / halfLifeDays)
 *   rawWeight = reinforcedImportance × timeDecayFactor
 *   minWeight = reinforcedImportance × importanceFloor
 *   effectiveWeight = max(rawWeight, minWeight)
 *
 * Time decay is based on when the memory was created or last reinforced with
 * new information — NOT when it was last passively retrieved. This prevents
 * a feedback loop where popular old memories never decay because retrieval
 * keeps resetting their timer.
 *
 * Uses reinforcedImportance (falling back to importance) as the base value,
 * consistent with the rest of the memory system.
 */
export function calculateEffectiveWeight(
  memory: Memory,
  config: MemoryWeightingConfig = DEFAULT_WEIGHTING_CONFIG,
  now: Date = new Date()
): EffectiveWeightResult {
  const baseImportance = memory.reinforcedImportance ?? memory.importance

  // Use max(createdAt, lastReinforcedAt) as the reference time for decay.
  // Passive retrieval (lastAccessedAt) does NOT reset the decay timer —
  // only actual reinforcement with new information does.
  const createdTime = new Date(memory.createdAt).getTime()
  const reinforcedTime = memory.lastReinforcedAt
    ? new Date(memory.lastReinforcedAt).getTime()
    : 0
  const referenceTime = Math.max(createdTime, reinforcedTime)

  const daysOld = Math.max(0, (now.getTime() - referenceTime) / 86400000)
  const timeDecayFactor = Math.pow(0.5, daysOld / config.halfLifeDays)
  const rawWeight = baseImportance * timeDecayFactor
  const minWeight = baseImportance * config.importanceFloor
  const effectiveWeight = Math.max(rawWeight, minWeight)

  return {
    effectiveWeight,
    rawWeight,
    minWeight,
    timeDecayFactor,
    daysOld,
    baseImportance,
  }
}

/**
 * Format a memory's age as a human-readable relative time label.
 * Used for temporal context in LLM memory injection.
 */
export function formatRelativeAge(memory: Memory, now: Date = new Date()): string {
  const createdTime = new Date(memory.createdAt).getTime()
  const reinforcedTime = memory.lastReinforcedAt
    ? new Date(memory.lastReinforcedAt).getTime()
    : 0
  const referenceTime = Math.max(createdTime, reinforcedTime)
  const daysOld = Math.max(0, (now.getTime() - referenceTime) / 86400000)

  if (daysOld < 1) return 'today'
  if (daysOld < 2) return 'yesterday'
  if (daysOld < 7) return `${Math.floor(daysOld)} days ago`
  if (daysOld < 14) return 'last week'
  if (daysOld < 30) return `${Math.floor(daysOld / 7)} weeks ago`
  if (daysOld < 60) return 'last month'
  if (daysOld < 365) return `${Math.floor(daysOld / 30)} months ago`
  return `${Math.floor(daysOld / 365)} year${Math.floor(daysOld / 365) > 1 ? 's' : ''} ago`
}

/**
 * Configuration for the housekeeping protection score.
 *
 * Distinct from retrieval ranking: protection decay runs on a longer half-life
 * with a lower floor, and the score blends the LLM-derived content signal with
 * usage evidence (reinforcement, graph degree, recency of access) so a memory's
 * fate doesn't hinge on the LLM's one-shot importance guess.
 */
export interface ProtectionScoreConfig {
  /** Content-score half-life in days. Longer than retrieval decay. Default: 365 */
  contentHalfLifeDays: number
  /** Minimum fraction of the content score that decay cannot erode past. Default: 0.10 */
  contentFloor: number
  /** Maximum bonus from reinforcement count (saturates via log2). Default: 0.25 */
  maxReinforcementBonus: number
  /** Per-reinforcement coefficient (applied to log2(count+1)). Default: 0.08 */
  reinforcementCoeff: number
  /** Maximum bonus from graph degree (related-memory links). Default: 0.10 */
  maxGraphDegreeBonus: number
  /** Per-link coefficient. Default: 0.025 */
  graphDegreeCoeff: number
  /** Bonus when lastAccessedAt is within the recency window. Default: 0.10 */
  recentAccessBonus: number
  /** Recent-access window in days. Default: 90 */
  recentAccessWindowDays: number
}

export const DEFAULT_PROTECTION_CONFIG: ProtectionScoreConfig = {
  contentHalfLifeDays: 365,
  contentFloor: 0.10,
  maxReinforcementBonus: 0.25,
  reinforcementCoeff: 0.08,
  maxGraphDegreeBonus: 0.10,
  graphDegreeCoeff: 0.025,
  recentAccessBonus: 0.10,
  recentAccessWindowDays: 90,
}

export interface ProtectionScoreResult {
  /** Final blended score in [0, 1]. Compare against a protection threshold. */
  score: number
  contentComponent: number
  reinforcementBonus: number
  graphDegreeBonus: number
  recentAccessBonus: number
  daysSinceRefTime: number
}

/**
 * Calculate a blended protection score for the housekeeping gate.
 *
 * Combines four evidence streams:
 *   1. Content score (LLM-derived importance), time-decayed with a low floor
 *   2. Reinforcement count (log2-saturated — first few reinforcements matter most)
 *   3. Graph degree (count of relatedMemoryIds — links imply centrality)
 *   4. Recent access (binary bonus if accessed within the recency window)
 *
 * Time-decay reference point is max(createdAt, lastReinforcedAt): passive
 * retrieval does NOT reset the clock, consistent with calculateEffectiveWeight.
 */
export function calculateProtectionScore(
  memory: Memory,
  config: ProtectionScoreConfig = DEFAULT_PROTECTION_CONFIG,
  now: Date = new Date()
): ProtectionScoreResult {
  const baseImportance = memory.reinforcedImportance ?? memory.importance

  const createdTime = new Date(memory.createdAt).getTime()
  const reinforcedTime = memory.lastReinforcedAt
    ? new Date(memory.lastReinforcedAt).getTime()
    : 0
  const referenceTime = Math.max(createdTime, reinforcedTime)
  const daysSinceRefTime = Math.max(0, (now.getTime() - referenceTime) / 86400000)

  const decay = Math.pow(0.5, daysSinceRefTime / config.contentHalfLifeDays)
  const contentComponent = baseImportance * Math.max(decay, config.contentFloor)

  const reinforcementCount = memory.reinforcementCount ?? 1
  const reinforcementBonus = Math.min(
    config.maxReinforcementBonus,
    Math.log2(reinforcementCount + 1) * config.reinforcementCoeff
  )

  const graphDegree = memory.relatedMemoryIds?.length ?? 0
  const graphDegreeBonus = Math.min(
    config.maxGraphDegreeBonus,
    graphDegree * config.graphDegreeCoeff
  )

  let recentAccessBonus = 0
  if (memory.lastAccessedAt) {
    const daysSinceAccess = (now.getTime() - new Date(memory.lastAccessedAt).getTime()) / 86400000
    if (daysSinceAccess < config.recentAccessWindowDays) {
      recentAccessBonus = config.recentAccessBonus
    }
  }

  const score = Math.min(
    1,
    contentComponent + reinforcementBonus + graphDegreeBonus + recentAccessBonus
  )

  return {
    score,
    contentComponent,
    reinforcementBonus,
    graphDegreeBonus,
    recentAccessBonus,
    daysSinceRefTime,
  }
}

/**
 * Rank memories by effective weight in descending order.
 * Optionally filters out memories below the minimum weight threshold.
 */
export function rankMemoriesByWeight(
  memories: Memory[],
  config: MemoryWeightingConfig = DEFAULT_WEIGHTING_CONFIG,
  now: Date = new Date()
): Array<{ memory: Memory; weightResult: EffectiveWeightResult }> {
  const weighted = memories.map(memory => ({
    memory,
    weightResult: calculateEffectiveWeight(memory, config, now),
  }))

  const filtered = weighted.filter(
    ({ weightResult }) => weightResult.effectiveWeight >= config.minWeightThreshold
  )

  filtered.sort((a, b) => b.weightResult.effectiveWeight - a.weightResult.effectiveWeight)

  logger.debug('[MemoryWeighting] Ranked memories by weight', {
    total: memories.length,
    afterFilter: filtered.length,
    filteredOut: memories.length - filtered.length,
  })

  return filtered
}
