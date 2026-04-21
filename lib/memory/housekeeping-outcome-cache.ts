/**
 * Housekeeping Outcome Cache
 *
 * Per-process in-memory record of the most recent completed housekeeping
 * sweep for each character. Used to short-circuit watermark-triggered
 * enqueues that would otherwise produce another 15-minute no-op sweep.
 *
 * In-memory is deliberate: losing this on restart means one extra sweep
 * attempt per character after a boot, which is cheap compared to the
 * complexity of a persistent per-character outcome row. The scheduled
 * daily sweep still runs regardless — this cache only gates the
 * post-extraction watermark path.
 */
const ZERO_DELETION_BACKOFF_MS = 60 * 60 * 1000 // 1 hour

interface SweepOutcome {
  completedAt: number
  deleted: number
}

const outcomes = new Map<string, SweepOutcome>()

export function recordHousekeepingOutcome(characterId: string, deleted: number): void {
  outcomes.set(characterId, { completedAt: Date.now(), deleted })
}

/**
 * Returns true when a watermark-triggered sweep should be skipped because
 * the previous sweep for this character deleted zero memories within the
 * last hour. Keeps the queue from thrashing on a character whose protection
 * score is over-eagerly protecting everything.
 */
export function shouldSkipWatermarkSweep(characterId: string): boolean {
  const last = outcomes.get(characterId)
  if (!last) return false
  if (last.deleted > 0) return false
  return Date.now() - last.completedAt < ZERO_DELETION_BACKOFF_MS
}

/** Exposed for tests. */
export function _clearHousekeepingOutcomesForTest(): void {
  outcomes.clear()
}
