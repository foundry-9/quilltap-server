/**
 * Salience — how much a memory is worth *saying*.
 *
 * `salience = reinforcedImportance × 0.5^(daysSince(max(createdAt, lastReinforcedAt)) / 30)`,
 * with no floor. It is the only "worth" used to order anything a model will
 * see: the recall blend, the fallback head, Carina, the inter-character
 * section, archive fill, first-message context and the search tool's final
 * sort. (It replaces the old floored `calculateEffectiveWeight`, whose 0.70
 * floor leaked into ranking at four call sites.) Whether a memory is worth
 * *keeping* is a different question, answered by `protection`.
 *
 * @module memory/scoring/salience
 */

import type { Memory } from '@/lib/schemas/types'

/** Days for the decay factor to reach 0.5. */
export const SALIENCE_HALF_LIFE_DAYS = 30

const DAY_MS = 86_400_000

/** The fields salience reads. */
export type SalienceInput = Pick<Memory, 'importance' | 'createdAt'> &
  Partial<Pick<Memory, 'reinforcedImportance' | 'lastReinforcedAt'>>

export interface SalienceBreakdown {
  /** The ordering key: `base × decay`. */
  salience: number
  /** `reinforcedImportance ?? importance`. */
  base: number
  /** `0.5^(daysSince / 30)`. */
  decay: number
  /** Days since the decay reference time (never negative). */
  daysSince: number
}

/**
 * Decay reference point for a memory: `max(createdAt, lastReinforcedAt)`.
 *
 * Passive retrieval (`lastAccessedAt`) never resets the decay clock — only
 * creation or reinforcement with new information does. Every decay or age
 * calculation in the scoring module derives its reference time from here.
 */
export function referenceTimeMs(memory: Pick<Memory, 'createdAt'> & Partial<Pick<Memory, 'lastReinforcedAt'>>): number {
  const createdTime = new Date(memory.createdAt).getTime()
  const reinforcedTime = memory.lastReinforcedAt ? new Date(memory.lastReinforcedAt).getTime() : 0
  return Math.max(createdTime, reinforcedTime)
}

/** How much a memory is worth saying now. Pure; `clock.nowMs` defaults to the wall clock. */
export function salience(memory: SalienceInput, clock: { nowMs?: number } = {}): SalienceBreakdown {
  const nowMs = clock.nowMs ?? Date.now()
  const base = memory.reinforcedImportance ?? memory.importance
  const daysSince = Math.max(0, (nowMs - referenceTimeMs(memory)) / DAY_MS)
  const decay = Math.pow(0.5, daysSince / SALIENCE_HALF_LIFE_DAYS)
  return { salience: base * decay, base, decay, daysSince }
}

/** Order memories by salience, highest first (stable for ties). Returns a new array. */
export function sortBySalience<T extends SalienceInput>(memories: readonly T[], clock: { nowMs?: number } = {}): T[] {
  const nowMs = clock.nowMs ?? Date.now()
  return memories
    .map((memory, index) => ({ memory, index, s: salience(memory, { nowMs }).salience }))
    .sort((a, b) => b.s - a.s || a.index - b.index)
    .map(x => x.memory)
}
