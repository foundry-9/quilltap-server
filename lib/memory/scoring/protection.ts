/**
 * Protection — how much a memory is worth *keeping*.
 *
 * The blended protection score (content ≤ 0.40, reinforcement ≤ 0.25, graph
 * ≤ 0.10, recent access +0.10, episodic +0.10; threshold 0.5) decides whether
 * maintenance may demote a row, and it is also the demotion order: the
 * lowest-protection row goes first, so the thing that decides whether a row
 * may go also decides which goes first. Ranking for a model is `salience`,
 * never this.
 *
 * @module memory/scoring/protection
 */

import type { Memory } from '@/lib/schemas/types'
import { referenceTimeMs } from './salience'

/** At or above this score an AUTO row is protected from demotion. */
export const PROTECTION_THRESHOLD = 0.5

/** The fields protection reads. */
export type ProtectionInput = Pick<Memory, 'importance' | 'createdAt'> &
  Partial<Pick<Memory, 'reinforcedImportance' | 'lastReinforcedAt' | 'reinforcementCount' | 'relatedMemoryIds' | 'lastAccessedAt' | 'kind' | 'source'>>

/**
 * Configuration for the housekeeping protection score.
 *
 * Distinct from retrieval ranking: protection decay runs on a longer half-life
 * with a lower floor, and the score blends the LLM-derived content signal with
 * usage evidence (reinforcement, graph degree, recency of access) so a memory's
 * fate doesn't hinge on the LLM's one-shot importance guess.
 */
export interface ProtectionScoreConfig {
  /** Content-score half-life in days. Default: 30. The original 365-day
   * default protected fresh LLM-scored memories indefinitely on heavy
   * characters (a 1-day-old memory at importance 0.7 scored ~0.70, well
   * above the 0.5 threshold), so the cap-enforcement pass deleted zero
   * rows on a 19.5k-memory character and pinned the main thread for
   * 15 minutes per run. 30 days gives young memories ~40% content score
   * after a month, letting the usage bonuses (reinforcement / graph / recent
   * access) — not just the LLM's one-shot importance guess — decide what
   * stays. */
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
  /** Maximum contribution the content component alone can make to the
   * protection score. Default: 0.40. Without this cap, an LLM-rated 0.7+
   * memory scores above the 0.5 protection threshold on content alone —
   * which, on a heavy character where 97% of memories are under a month
   * old, means the cap-enforcement pass protects essentially everything.
   * Capping content forces a memory to earn the remaining headroom from
   * usage evidence (reinforcement count, graph degree, or recent access)
   * to cross the threshold. Honors the blended-score design goal of
   * "LLM opinion is one input among several, not a final verdict." */
  maxContentContribution: number
  /** Additive bonus for `kind: 'episodic'` rows. Default: 0.10. Episodic
   * memories carry the exact statistical profile housekeeping deletes first
   * (low importance, low reinforcement, low graph degree) yet are the hardest
   * to regenerate — a one-off visit never recurs to be re-extracted. The
   * vault Timeline is the durable backstop, but the memory ROW is what
   * per-turn retrieval actually hits, so it should be the last to go. */
  episodicBonus: number
}

export const DEFAULT_PROTECTION_CONFIG: ProtectionScoreConfig = {
  contentHalfLifeDays: 30,
  contentFloor: 0.10,
  maxReinforcementBonus: 0.25,
  reinforcementCoeff: 0.08,
  maxGraphDegreeBonus: 0.10,
  graphDegreeCoeff: 0.025,
  recentAccessBonus: 0.10,
  recentAccessWindowDays: 90,
  maxContentContribution: 0.40,
  episodicBonus: 0.10,
}

export interface ProtectionScoreResult {
  /** Final blended score in [0, 1]. Compare against a protection threshold. */
  score: number
  contentComponent: number
  reinforcementBonus: number
  graphDegreeBonus: number
  recentAccessBonus: number
  episodicBonus: number
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
 * retrieval does NOT reset the clock, consistent with salience.
 */
export function calculateProtectionScore(
  memory: ProtectionInput,
  config: ProtectionScoreConfig = DEFAULT_PROTECTION_CONFIG,
  now: Date = new Date()
): ProtectionScoreResult {
  const baseImportance = memory.reinforcedImportance ?? memory.importance

  const referenceTime = referenceTimeMs(memory)
  const daysSinceRefTime = Math.max(0, (now.getTime() - referenceTime) / 86400000)

  const decay = Math.pow(0.5, daysSinceRefTime / config.contentHalfLifeDays)
  const contentComponent = Math.min(
    config.maxContentContribution,
    baseImportance * Math.max(decay, config.contentFloor)
  )

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

  // Episodic protection bump: one-off dated occurrences are the first thing
  // the retention rules would otherwise delete and the hardest to regenerate.
  const episodicBonus = memory.kind === 'episodic' ? config.episodicBonus : 0

  const score = Math.min(
    1,
    contentComponent + reinforcementBonus + graphDegreeBonus + recentAccessBonus + episodicBonus
  )

  return {
    score,
    contentComponent,
    reinforcementBonus,
    graphDegreeBonus,
    recentAccessBonus,
    episodicBonus,
    daysSinceRefTime,
  }
}

export interface ProtectionBreakdown extends ProtectionScoreResult {
  /** True for MANUAL and CONSOLIDATED rows, and for AUTO rows at or above {@link PROTECTION_THRESHOLD}. */
  protected: boolean
  /** True when the row's source alone protects it (MANUAL or CONSOLIDATED; score reported as 1). */
  protectedBySource: boolean
}

/**
 * How much a memory is worth keeping. A hand-written (MANUAL) row or a digest
 * (CONSOLIDATED) is never policy's to remove: it reports `protected: true`
 * with score 1. Any other row is protected when its blended score reaches
 * {@link PROTECTION_THRESHOLD}. Pure; `clock.nowMs` defaults to the wall clock.
 */
export function protection(
  memory: ProtectionInput,
  clock: { nowMs?: number } = {},
  config: ProtectionScoreConfig = DEFAULT_PROTECTION_CONFIG,
): ProtectionBreakdown {
  const result = calculateProtectionScore(memory, config, new Date(clock.nowMs ?? Date.now()))
  if (memory.source === 'MANUAL' || memory.source === 'CONSOLIDATED') {
    return { ...result, score: 1, protected: true, protectedBySource: true }
  }
  return { ...result, protected: result.score >= PROTECTION_THRESHOLD, protectedBySource: false }
}
