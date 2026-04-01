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

  logger.debug('[MemoryWeighting] Calculated effective weight', {
    memoryId: memory.id,
    baseImportance: baseImportance.toFixed(3),
    daysOld: daysOld.toFixed(1),
    timeDecayFactor: timeDecayFactor.toFixed(4),
    rawWeight: rawWeight.toFixed(4),
    minWeight: minWeight.toFixed(4),
    effectiveWeight: effectiveWeight.toFixed(4),
    floorApplied: rawWeight < minWeight,
  })

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
