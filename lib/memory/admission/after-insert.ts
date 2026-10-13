/**
 * What follows a new row: the housekeeping watermark.
 *
 * Runs in the process that asked for the admission — the job child for an
 * extraction, where the housekeeping job records its outcomes
 * (`housekeeping-outcome-cache.ts`), so the one-hour backoff after an
 * ineffective sweep is read where it is written. (The consolidation watermark
 * runs in the parent, in `admitPrepared`, where its counts see the row.)
 *
 * @module memory/admission/after-insert
 */

import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import { getMemoryMaintenanceSettings } from '@/lib/instance-settings'
import { resolveMemoryCap } from '../settings'
import { shouldSkipWatermarkSweep } from '../housekeeping-outcome-cache'

/** Fraction of the per-character cap at which auto-housekeeping engages. */
const HOUSEKEEPING_WATERMARK = 0.9

/**
 * Minimum gap between watermark-triggered housekeeping sweeps for a single
 * character, enforced durably via the background-jobs table so it survives
 * restarts and holds across the forked-child job pool. Prevents a room sitting
 * at its cap from kicking off an (often expensive) sweep on every turn. The
 * daily scheduled sweep is unaffected.
 */
const WATERMARK_SWEEP_THROTTLE_MS = 15 * 60 * 1000 // 15 minutes

/**
 * If memory maintenance is enabled and the character has reached
 * the watermark fraction of its cap, enqueue a housekeeping job for that
 * character. The enqueue helper dedupes against in-flight jobs, so calling
 * this after every insert is safe even during high-frequency extraction.
 *
 * Never throws — a failure here must not block the memory write that just
 * succeeded.
 */
export async function maybeEnqueueHousekeeping(characterId: string, userId: string): Promise<void> {
  try {
    const repos = getRepositories()
    const maintenance = await getMemoryMaintenanceSettings()
    if (!maintenance.enabled) {
      return
    }

    const cap = resolveMemoryCap(maintenance, characterId)

    // The cap measures demotable rows only — hot AUTO (bug 210). MANUAL rows,
    // digests and the cold archive never count against it.
    const { demotable: count } = await repos.memories.countCapBreakdown(characterId)
    if (count < Math.floor(cap * HOUSEKEEPING_WATERMARK)) {
      return
    }

    // When the previous sweep for this character deleted nothing, it's very
    // likely the next watermark-triggered sweep will also delete nothing —
    // the protection score just said everything was worth keeping, and
    // ~6 extra memories per chat turn won't flip that verdict. Running the
    // sweep anyway burns 10–15 minutes of main-thread time for no benefit
    // and blocks the next chat turn's context build. Back off for an hour.
    if (shouldSkipWatermarkSweep(characterId)) {
      return
    }

    // Durable post-restart throttle. The in-memory cache above lives in the
    // job child (the extraction job reads it, the housekeeping job writes it,
    // and the host keeps one child), but it is wiped whenever that child or
    // the server restarts. The result is a storm of redundant (and expensive)
    // sweeps when a room sits right at its
    // cap. Back it with a DB floor: if a sweep for this character already
    // completed or is running within the throttle window, don't pile on
    // another. The daily scheduled sweep still handles deep cleaning.
    const recentHousekeeping = await repos.backgroundJobs.findRecentByType(
      'MEMORY_HOUSEKEEPING',
      50,
    )
    const nowMs = Date.now()
    const throttledByRecentSweep = recentHousekeeping.some(j => {
      const jobCharId = (j.payload as Record<string, unknown> | undefined)?.characterId
      if (jobCharId !== characterId) return false
      if (j.status !== 'COMPLETED' && j.status !== 'PROCESSING') return false
      const ts = j.updatedAt ? new Date(j.updatedAt).getTime() : 0
      return nowMs - ts < WATERMARK_SWEEP_THROTTLE_MS
    })
    if (throttledByRecentSweep) {
      logger.debug('[Housekeeping] Skipping watermark sweep — recent sweep within throttle window', {
        characterId,
        throttleMs: WATERMARK_SWEEP_THROTTLE_MS,
      })
      return
    }

    const { enqueueMemoryHousekeeping } = await import('@/lib/background-jobs/queue-service')
    await enqueueMemoryHousekeeping(userId, {
      characterId,
      reason: 'watermark',
    })
  } catch (error) {
    logger.warn('[Housekeeping] Failed watermark check after insert (non-fatal)', {
      userId,
      characterId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

