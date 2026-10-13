/**
 * The extraction rate limit (memory refactor §3.7): a live counter.
 *
 * With `memoryExtractionLimits.enabled`, a character who has gained
 * `maxPerHour` memories in the last hour is skipped, and past
 * `softStartFraction` of it only candidates at or above `softFloor` are kept.
 * The count is the parent's ledger of admissions it has seen land
 * (`admission/rate-ledger.ts`), read once per character per unit of work, plus
 * every insert this unit of work makes as it lands — so the last candidates of
 * a long fold see the first ones, and a dry run counts what it would insert.
 *
 * @module memory/extraction/rate-limit
 */

import type { MemoryExtractionLimits } from '@/lib/schemas/settings.types'
import { countRecentAdmissions, RATE_LEDGER_WINDOW_MS } from '../admission'
import type { MemoryDraft } from '../cheap-llm-tasks/types'
import { logger } from '@/lib/logger'

export type RateLimitDecision =
  | { mode: 'allow' }
  | { mode: 'throttle'; floor: number; recentCount: number; cap: number }
  | { mode: 'skip'; recentCount: number; cap: number }

export interface RateLimiter {
  /** What this character may admit now. */
  decide(characterId: string): Promise<RateLimitDecision>
  /** Count inserts that just landed (or, in a dry run, would have). */
  record(characterId: string, inserted?: number): void
}

/** The decision for a count under `limits`. Pure. */
export function rateLimitDecision(recentCount: number, limits: MemoryExtractionLimits): RateLimitDecision {
  if (!limits.enabled) return { mode: 'allow' }
  if (recentCount >= limits.maxPerHour) return { mode: 'skip', recentCount, cap: limits.maxPerHour }
  const softStart = Math.floor(limits.maxPerHour * limits.softStartFraction)
  if (recentCount >= softStart) {
    return { mode: 'throttle', floor: limits.softFloor, recentCount, cap: limits.maxPerHour }
  }
  return { mode: 'allow' }
}

/** Drafts at or above the importance floor. */
export function applyImportanceFloor(drafts: MemoryDraft[], floor: number): MemoryDraft[] {
  return drafts.filter(d => d.importance >= floor)
}

/**
 * A limiter for one unit of work. `readBaseline` defaults to the parent's
 * admission ledger; tests pass their own.
 */
export function createRateLimiter(
  limits: MemoryExtractionLimits,
  readBaseline: (characterId: string, sinceMs: number) => Promise<number> = countRecentAdmissions,
): RateLimiter {
  const baselines = new Map<string, Promise<number>>()
  const landed = new Map<string, number>()

  const baselineFor = (characterId: string): Promise<number> => {
    let baseline = baselines.get(characterId)
    if (!baseline) {
      baseline = readBaseline(characterId, Date.now() - RATE_LEDGER_WINDOW_MS).catch((error) => {
        logger.warn('[Memory] Rate-limit lookup failed; allowing extraction', {
          characterId,
          error: error instanceof Error ? error.message : String(error),
        })
        return 0
      })
      baselines.set(characterId, baseline)
    }
    return baseline
  }

  return {
    async decide(characterId) {
      if (!limits.enabled) return { mode: 'allow' }
      const recent = (await baselineFor(characterId)) + (landed.get(characterId) ?? 0)
      return rateLimitDecision(recent, limits)
    },
    record(characterId, inserted = 1) {
      // Before the baseline is read, the ledger already holds these inserts.
      if (!limits.enabled || !baselines.has(characterId) || inserted <= 0) return
      landed.set(characterId, (landed.get(characterId) ?? 0) + inserted)
    },
  }
}
