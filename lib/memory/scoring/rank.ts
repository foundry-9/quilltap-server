/**
 * `rankForRecall` — the one recall ranking: the blend
 * (`0.75 × relevance + 0.25 × salience`), the bounded recall multipliers read
 * from the targeting tags and the turn's context (R1 gate, R2 cap — the table
 * and the combine live in `recall/tags.ts`), and R6's background reservation.
 *
 * The constants do not move in the refactor (decision 14); the probe fixture
 * under `__tests__/fixtures/recall-probes/` pins them.
 *
 * @module memory/scoring/rank
 */

import type { Memory } from '@/lib/schemas/types'
import { computeRankingBlend } from './relevance'
import { combineRecallMultipliers, type RecallContext } from '../recall/tags'
import type { RecallCandidate } from '../recall/types'

/** A candidate ready to rank: its row, relevance, the raw cosine R1 gates on, and salience. */
export interface RankInput {
  memory: Memory
  /** Relevance (literal-boosted on the tool path). */
  score: number
  /** The raw cosine (or text score) — the R1 gate's input. */
  rawScore: number
  salience: number
  usedEmbedding: boolean
}

/** Descending by post-adjustment blended score (stable). */
export function byBlendedAfter(a: RecallCandidate, b: RecallCandidate): number {
  return (b.recallAdjustment?.blendedAfter ?? 0) - (a.recallAdjustment?.blendedAfter ?? 0)
}

/**
 * Rank candidates under a turn's recall context. Each keeps its blend, takes
 * the combined multiplier (gated on its own raw cosine against the pool's
 * best), and is sorted by the result; a cross-project narrow row under the
 * `exclude` policy is dropped. `extraFired` labels every row of this call
 * (`related↗` for expansion, `bg↺` for R6).
 */
export function rankForRecall(
  candidates: readonly RankInput[],
  ctx: RecallContext,
  bestCosine: number,
  extraFired: readonly string[] = [],
): RecallCandidate[] {
  const out: RecallCandidate[] = []
  for (const c of candidates) {
    const blendedBefore = computeRankingBlend(c.score, c.salience)
    const adj = combineRecallMultipliers(c.memory, ctx, { cosine: c.rawScore, bestCosine })
    if (adj.exclude) continue
    out.push({
      memory: c.memory,
      score: c.score,
      usedEmbedding: c.usedEmbedding,
      salience: c.salience,
      recallAdjustment: {
        multiplier: adj.multiplier,
        fired: [...adj.fired, ...extraFired],
        blendedBefore,
        blendedAfter: blendedBefore * adj.multiplier,
      },
    })
  }
  return out.sort(byBlendedAfter)
}

/** Rank without a recall context: the blend alone (the tool, the API, Carina). */
export function rankByBlend(candidates: readonly RankInput[]): RecallCandidate[] {
  return candidates
    .map(c => ({ memory: c.memory, score: c.score, usedEmbedding: c.usedEmbedding, salience: c.salience }))
    .sort((a, b) => computeRankingBlend(b.score, b.salience) - computeRankingBlend(a.score, a.salience))
}

/**
 * R6 — reserve up to `fraction` of the head for qualifying background rows.
 * The head becomes the top `headSize − k` ranked rows plus the top `k`
 * background rows (`k` = reserve, or fewer when fewer qualify — unused slots go
 * back to the ranked rows), each part ranked as before and the head re-sorted
 * by score. Everything else follows in score order.
 */
export function reserveBackgroundSlots(
  ranked: RecallCandidate[],
  background: RecallCandidate[],
  headSize: number,
  fraction: number,
): RecallCandidate[] {
  const reserve = Math.floor(headSize * fraction)
  const taken = Math.min(reserve, background.length)
  if (taken === 0) return ranked
  const head = [...ranked.slice(0, headSize - taken), ...background.slice(0, taken)].sort(byBlendedAfter)
  const tail = [...ranked.slice(headSize - taken), ...background.slice(taken)].sort(byBlendedAfter)
  return [...head, ...tail]
}
