/**
 * The shapes that pass between the recall stages (memory refactor §3.8):
 *
 * ```
 * query → gather → hydrate → score → select → assemble → render → deliver
 * ```
 *
 * Every stage after `gather` and `hydrate` is a pure function of the previous
 * stage's output, and each appends one entry to the {@link RecallTrace}, which
 * the replay harness reports and `deliver` writes to the turn's debug log.
 *
 * @module memory/recall/types
 */

import type { Memory } from '@/lib/schemas/types'

/** How a raw hit entered the pool. */
export type HitSource = 'vector' | 'probe' | 'anchor' | 'literal' | 'text'

/**
 * A candidate before hydration: an id and the score it entered with. For the
 * vector strategy `score` is the cosine against the query (the best across
 * probes); for the text strategy it is the text-match score, and the row is
 * already in hand.
 */
export interface RawHit {
  id: string
  score: number
  via: HitSource
  /** Present when the strategy already read the row (anchors, the text fallback). */
  memory?: Memory
}

/** A hit with its row, after the hydrate filters. */
export interface HydratedHit {
  memory: Memory
  /** The cosine (or text score) as gathered — R1's gate reads this. */
  rawScore: number
  /** `rawScore`, after the tool's literal-phrase boost when one applied. */
  score: number
  usedEmbedding: boolean
}

/** The record of why a candidate ranked where it did. */
export interface RecallAdjustment {
  /** Combined, clamped multiplier applied to the blended score. */
  multiplier: number
  /** Short labels for the adjustments that fired (e.g. `narrow✓`, `past↓`). Debug only. */
  fired: string[]
  /** The ranking blend (`0.75 × relevance + 0.25 × salience`) before the multiplier. */
  blendedBefore: number
  /** The blend after the multiplier — what the head ranks on. */
  blendedAfter: number
}

/**
 * A ranked recall candidate: the row, its relevance (`score`), its salience and,
 * when a turn's recall context drove the ranking, the adjustment record.
 */
export interface RecallCandidate {
  memory: Memory
  /** Relevance: the cosine (literal-boosted on the tool path) or the text score. */
  score: number
  /** True when the score is a cosine; false on the text fallback. */
  usedEmbedding: boolean
  /** `reinforcedImportance × decay` at the search clock. */
  salience: number
  recallAdjustment?: RecallAdjustment
}

/** The stages, in order. */
export type RecallStage =
  | 'query'
  | 'gather'
  | 'hydrate'
  | 'score'
  | 'select'
  | 'assemble'
  | 'render'
  | 'deliver'

/** One stage's account of itself: counts and choices, never memory text. */
export interface RecallTraceEntry {
  stage: RecallStage
  /** Which search or pool the entry belongs to, when more than one ran. */
  label?: string
  detail: Record<string, unknown>
}

export type RecallTrace = RecallTraceEntry[]

/** Append a trace entry (the stages' one way of writing to the trace). */
export function traceStage(
  trace: RecallTrace,
  stage: RecallStage,
  detail: Record<string, unknown>,
  label?: string,
): void {
  trace.push(label ? { stage, label, detail } : { stage, detail })
}

/** One line a renderer produced: which memory, and the text that carries it. */
export interface RenderedLine {
  memoryId: string
  /** The whole rendered line. */
  line: string
  /** The memory's own words on the line — what `deliver` looks for after compression. */
  body: string
}

/** One inner-circle row in a frozen archive: the digest and where it sits in the circle. */
export interface InnerCircleEntry {
  memory: Memory
  /** The circle member the digest is about. */
  characterId: string
  /** The member's tier (0 = the holder's tightest group). */
  tier: number
  /** The digest's rank within its member's draw (0 = the member's first). */
  rank: number
  /** The member's position in circle order. */
  order: number
}

/**
 * Circle rows from most to least protected: tighter tier first, then a
 * member's earlier digests, then circle order. The archive's cap and the
 * renderer's token budget both cut from the end of this order, so the loosest
 * tier gives up lines first.
 */
export function innerCircleTrimOrder<T extends Pick<InnerCircleEntry, 'tier' | 'rank' | 'order'>>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => a.tier - b.tier || a.rank - b.rank || a.order - b.order)
}

/** Which section a delivered row was in. */
export type RecallPool = 'archive' | 'head' | 'interCharacter' | 'recap' | 'relevant'
