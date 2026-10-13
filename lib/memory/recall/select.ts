/**
 * Stage 5 — select: related expansion, R6's background reservation, the cut.
 *
 * Expansion (item 5) catches the memory that is relevant by association but
 * did not clear the floor on its own: the neighbours `hydrateNeighbours` read
 * are scored against the same query vector, ranked under the same context
 * (gated on their own cosine) and merged. The floor is deliberately not
 * re-applied to them — association is the point. Pure.
 *
 * @module memory/recall/select
 */

import type { Memory } from '@/lib/schemas/types'
import { cosineSimilarity } from '@/lib/embedding/embedding-service'
import { byBlendedAfter, rankForRecall, reserveBackgroundSlots, salience } from '../scoring'
import { boostGateThreshold, recallTuningOf } from './tags'
import type { Scored } from './score'
import { traceStage, type RecallCandidate, type RecallTrace } from './types'

export interface SelectOptions {
  limit: number
  /** The head the caller will take — only R6 reads it. */
  headSize?: number
  /** The query vector expansion scores neighbours against. */
  queryEmbedding: Float32Array | null
  nowMs: number
}

/** Expansion runs for a vector search under a context that asks for it. */
export function wantsExpansion(scored: Scored): boolean {
  return scored.strategy === 'vector' && scored.context?.expandRelated === true
}

export function select(
  scored: Scored,
  neighbours: readonly Memory[],
  opts: SelectOptions,
  trace: RecallTrace = [],
  label?: string,
): RecallCandidate[] {
  let results = scored.ranked
  const ctx = scored.context
  let expanded = 0
  if (ctx && wantsExpansion(scored) && opts.queryEmbedding && neighbours.length > 0) {
    const query = opts.queryEmbedding
    const scorable = neighbours
      .filter(m => m.embedding && m.embedding.length === query.length)
      .map(m => {
        const cosine = cosineSimilarity(query, m.embedding!)
        return {
          memory: m,
          score: cosine,
          rawScore: cosine,
          usedEmbedding: true,
          salience: salience(m, { nowMs: opts.nowMs }).salience,
        }
      })
    const survivors = rankForRecall(scorable, ctx, scored.bestCosine, ['related↗'])
    expanded = survivors.length
    if (survivors.length > 0) results = [...results, ...survivors].sort(byBlendedAfter)
  }

  // R6 — when the window filtered hard, keep room in the head for
  // out-of-window background that clears the gate at full strength.
  let reserved = 0
  const tuning = ctx ? recallTuningOf(ctx) : undefined
  const gate = tuning?.boostGate
  if (ctx && gate && tuning.backgroundReserve > 0 && scored.outOfWindow.length > 0 && opts.headSize) {
    const threshold = boostGateThreshold(gate, scored.bestCosine)
    const present = new Set(results.map(r => r.memory.id))
    const background = rankForRecall(
      scored.outOfWindow.filter(c => !present.has(c.memory.id) && c.rawScore >= threshold),
      ctx,
      scored.bestCosine,
      ['bg↺'],
    )
    reserved = Math.min(Math.floor(opts.headSize * tuning.backgroundReserve), background.length)
    results = reserveBackgroundSlots(results, background, opts.headSize, tuning.backgroundReserve)
  }

  const out = results.slice(0, opts.limit)
  traceStage(trace, 'select', { expanded, reserved, cut: Math.max(0, results.length - out.length), returned: out.length }, label)
  return out
}
