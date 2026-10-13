/**
 * Stage 4 — score: relevance · salience · multipliers.
 *
 * Applies the relevance floor (on the raw cosine, before the blend, so a
 * low-relevance row cannot ride its importance in), measures salience on the
 * search clock, stages the event-time window and ranks through
 * `rankForRecall`. Pure.
 *
 * The window is two-stage on the prompt paths (a recall context is present):
 * hard when at least `limit` hits fall inside it, otherwise the bounded
 * ×`occurredWithinWindow` boost on the whole pool — never fewer results than an
 * unwindowed search. Without a recall context (the tool) it is a plain filter.
 *
 * @module memory/recall/score
 */

import { rankByBlend, rankForRecall, salience, type RankInput } from '../scoring'
import { recallTuningOf, type RecallContext } from './tags'
import type { Gathered } from './gather'
import { traceStage, type HydratedHit, type RecallCandidate, type RecallTrace } from './types'

export interface ScoreOptions {
  limit: number
  /** The turn's recall context. Absent → the blend alone, window as a filter. */
  recallContext?: RecallContext
  window: { from: string; to: string } | null
  /** The salience clock (the replay pins it to the replayed turn). */
  nowMs: number
}

export interface Scored {
  strategy: Gathered['strategy']
  ranked: RecallCandidate[]
  /** The recall context the ranking ran under (the soft window rides on it). */
  context: RecallContext | undefined
  /** The best raw score in the floored pool — R1's reference point. */
  bestCosine: number
  /** Rows a hard window set aside (R6 may reserve head room for some). */
  outOfWindow: RankInput[]
  windowMode: 'none' | 'filter' | 'hard' | 'soft'
}

function parseWindow(window: { from: string; to: string } | null): { from: number; to: number } | null {
  if (!window) return null
  const from = Date.parse(window.from)
  const to = Date.parse(window.to)
  return Number.isFinite(from) && Number.isFinite(to) && from <= to ? { from, to } : null
}

export function score(
  hydrated: readonly HydratedHit[],
  gathered: Pick<Gathered, 'strategy' | 'minScore' | 'provider'>,
  opts: ScoreOptions,
  trace: RecallTrace = [],
  label?: string,
): Scored {
  const floored = hydrated.filter(h =>
    gathered.strategy === 'text' ? h.score > 0 : h.score >= gathered.minScore,
  )
  const pool: RankInput[] = floored.map(h => ({
    memory: h.memory,
    score: h.score,
    rawScore: h.rawScore,
    usedEmbedding: h.usedEmbedding,
    salience: salience(h.memory, { nowMs: opts.nowMs }).salience,
  }))
  const bestCosine = pool.reduce((best, c) => Math.max(best, c.rawScore), 0)

  // R1's constants are on the neural cosine scale: off for TF-IDF vectors (when
  // the context brings no tuning of its own) and for text scores.
  let context = opts.recallContext
  if (context && gathered.strategy === 'text') {
    context = { ...context, tuning: { ...recallTuningOf(context), boostGate: null } }
  } else if (context && !context.tuning && gathered.provider === 'BUILTIN') {
    context = { ...context, tuning: { ...recallTuningOf(context), boostGate: null } }
  }

  let candidates = pool
  let outOfWindow: RankInput[] = []
  let windowMode: Scored['windowMode'] = 'none'
  let rankContext = context
  const window = parseWindow(opts.window)
  if (window) {
    const inWindow = (c: RankInput): boolean => {
      const t = Date.parse(c.memory.occurredAt ?? c.memory.createdAt)
      return Number.isFinite(t) && t >= window.from && t <= window.to
    }
    const hits = pool.filter(inWindow)
    if (!context) {
      candidates = hits
      windowMode = 'filter'
    } else if (hits.length >= opts.limit) {
      if (gathered.strategy === 'vector') outOfWindow = pool.filter(c => !inWindow(c))
      candidates = hits
      windowMode = 'hard'
    } else {
      rankContext = { ...context, occurredWithin: opts.window }
      windowMode = 'soft'
    }
  }

  const ranked = rankContext ? rankForRecall(candidates, rankContext, bestCosine) : rankByBlend(candidates)
  traceStage(trace, 'score', {
    floor: gathered.strategy === 'text' ? '>0' : gathered.minScore,
    floored: hydrated.length - floored.length,
    bestCosine: Math.round(bestCosine * 1000) / 1000,
    window: windowMode,
    excluded: candidates.length - ranked.length,
    ranked: ranked.length,
  }, label)
  return { strategy: gathered.strategy, ranked, context: rankContext, bestCosine, outOfWindow, windowMode }
}
