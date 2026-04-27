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
const INEFFECTIVE_BACKOFF_MS = 60 * 60 * 1000 // 1 hour

/** A sweep counts as "effective" when it deleted at least this many rows.
 * On a character whose cap is, say, 5k and corpus is 17k, the excess is
 * 12k and a sweep that trims 1–6 rows is practically a no-op — but the
 * initial design that keyed off `deleted === 0` didn't catch it, so the
 * watermark kept re-enqueueing after every chat turn anyway. */
const MIN_EFFECTIVE_DELETIONS = 10

/** Above this excess (count − cap), a sweep needs to delete at least
 * `excess × EXCESS_RATIO_THRESHOLD` rows to count as effective. Prevents
 * the single-digit-deletion treadmill on heavily oversized corpora. */
const EXCESS_RATIO_THRESHOLD = 0.01

interface SweepOutcome {
  completedAt: number
  deleted: number
  totalBefore: number
  cap: number
}

const outcomes = new Map<string, SweepOutcome>()

export function recordHousekeepingOutcome(
  characterId: string,
  deleted: number,
  totalBefore: number,
  cap: number,
): void {
  outcomes.set(characterId, { completedAt: Date.now(), deleted, totalBefore, cap })
}

/**
 * Returns true when a watermark-triggered sweep should be skipped because
 * the previous sweep for this character was ineffective within the last
 * hour. A sweep is ineffective when it deleted fewer rows than both a
 * small floor (10) and a tiny fraction (1%) of the excess over the cap —
 * i.e., the protection score protected everything and running again
 * won't help.
 */
export function shouldSkipWatermarkSweep(characterId: string): boolean {
  const last = outcomes.get(characterId)
  if (!last) return false
  if (Date.now() - last.completedAt >= INEFFECTIVE_BACKOFF_MS) return false

  const excess = Math.max(0, last.totalBefore - last.cap)
  const minEffective = Math.max(
    MIN_EFFECTIVE_DELETIONS,
    Math.floor(excess * EXCESS_RATIO_THRESHOLD),
  )
  return last.deleted < minEffective
}

/** Exposed for tests. */
export function _clearHousekeepingOutcomesForTest(): void {
  outcomes.clear()
}
