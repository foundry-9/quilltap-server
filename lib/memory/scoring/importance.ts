/**
 * Importance filters and bands.
 *
 * Every `minImportance` filter compares `reinforcedImportance` (falling back
 * to `importance` for a row that has none), and the per-path values collapse
 * to two named constants: every prompt path recalls at
 * {@link RECALL_MIN_IMPORTANCE}; the search tool and the Memories API at
 * {@link TOOL_MIN_IMPORTANCE}.
 *
 * @module memory/scoring/importance
 */

/** The importance floor for every path that puts memories in a prompt (head, proactive, inter-character, Carina, voice-rewrite, replay). */
export const RECALL_MIN_IMPORTANCE = 0.3

/** The importance floor for the search tool and the Memories API: none. */
export const TOOL_MIN_IMPORTANCE = 0

/** At or above this a memory is in the high band. */
export const IMPORTANCE_HIGH = 0.7
/** Below this a memory is in the low band. */
export const IMPORTANCE_LOW = 0.3

export type ImportanceBand = 'high' | 'medium' | 'low'

/** The value every importance filter and band reads: `reinforcedImportance ?? importance`. */
export function filterImportance(memory: { importance: number; reinforcedImportance?: number | null }): number {
  return memory.reinforcedImportance ?? memory.importance
}

/** The band of an importance value: high ≥ 0.7, low < 0.3, medium between. */
export function importanceBand(value: number): ImportanceBand {
  if (value >= IMPORTANCE_HIGH) return 'high'
  if (value < IMPORTANCE_LOW) return 'low'
  return 'medium'
}
