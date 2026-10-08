/**
 * Consolidation triggers — when a MEMORY_CONSOLIDATION job is enqueued.
 *
 * Three ways in (memory-consolidation-and-tiers.md §C1):
 *
 *   - **Scheduled**: {@link runScheduledConsolidation}, called by the daily
 *     housekeeping sweep *before* it enqueues housekeeping, enqueues one job
 *     per character that has anything never considered.
 *   - **Watermark**: {@link maybeEnqueueConsolidationAfterCommit}, called by
 *     the job dispatcher once a job's write batch has committed, enqueues a
 *     run for any character whose never-considered hot rows now exceed
 *     `memoryConsolidation.watermark`. Parent-side, after commit, so the count
 *     sees the rows the batch just wrote.
 *   - **Manual**: the API / CLI call `enqueueMemoryConsolidation` or
 *     `runConsolidation` directly.
 *
 * Both automatic triggers do nothing unless `memoryConsolidation.enabled`.
 *
 * The watermark path has to stay cheap: it runs after every memory-writing
 * job. It reads one instance setting, and only when consolidation is enabled
 * does it spend one COUNT per character — at most once per
 * {@link WATERMARK_CHECK_DEBOUNCE_MS} per character — and it will not
 * re-enqueue a character whose last run is younger than
 * {@link WATERMARK_RUN_THROTTLE_MS}. The throttle matters because the count
 * includes rows still younger than `matureAfterDays`, which a run cannot yet
 * consider: without it, a character over the watermark on immature rows alone
 * would be re-enqueued on every debounce tick.
 *
 * @module memory/consolidation-triggers
 */

import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import { getMemoryConsolidationSettings } from '@/lib/instance-settings'

const log = logger.child({ module: 'memory:consolidation-triggers' })

/** Minimum gap between watermark COUNTs for one character. */
export const WATERMARK_CHECK_DEBOUNCE_MS = 10 * 60 * 1000

/** A watermark run is not re-enqueued while the character's last run is younger than this. */
export const WATERMARK_RUN_THROTTLE_MS = 6 * 60 * 60 * 1000

/** Characters need at least this many never-considered hot rows for a scheduled run to be worth a job. */
const SCHEDULED_MIN_UNCONSIDERED = 2

const lastWatermarkCheck = new Map<string, number>()

/** Test hook. */
export function resetConsolidationTriggerStateForTests(): void {
  lastWatermarkCheck.clear()
}

/** A buffered write as the dispatcher sees it. */
export interface CommittedWrite {
  method: string
  args: readonly unknown[]
}

/**
 * The characters a committed batch wrote new memory rows for — every
 * `memories.create` names its holder on the first argument.
 */
export function characterIdsFromMemoryWrites(writes: readonly CommittedWrite[]): string[] {
  const ids = new Set<string>()
  for (const write of writes) {
    if (write.method !== 'memories.create') continue
    const data = write.args?.[0]
    if (data && typeof data === 'object') {
      const characterId = (data as Record<string, unknown>).characterId
      if (typeof characterId === 'string' && characterId.length > 0) ids.add(characterId)
    }
  }
  return Array.from(ids)
}

/** True when a MEMORY_CONSOLIDATION job for this character ran (or is running) inside the throttle window. */
async function ranRecently(characterId: string, nowMs: number): Promise<boolean> {
  const recent = await getRepositories().backgroundJobs.findRecentByType('MEMORY_CONSOLIDATION', 50)
  return recent.some((job) => {
    const payload = job.payload as Record<string, unknown> | undefined
    if (payload?.characterId !== characterId || payload?.dryRun === true) return false
    if (job.status !== 'COMPLETED' && job.status !== 'PROCESSING' && job.status !== 'PENDING') return false
    const ts = job.updatedAt ? Date.parse(job.updatedAt) : 0
    return nowMs - ts < WATERMARK_RUN_THROTTLE_MS
  })
}

/**
 * Watermark check for a set of characters. Never throws — a failure here must
 * not disturb the job whose commit called it.
 */
export async function maybeEnqueueConsolidationForCharacters(
  characterIds: readonly string[],
  nowMs: number = Date.now(),
): Promise<string[]> {
  const enqueued: string[] = []
  if (characterIds.length === 0) return enqueued
  try {
    const settings = await getMemoryConsolidationSettings()
    if (!settings.enabled) return enqueued

    const repos = getRepositories()
    for (const characterId of characterIds) {
      const last = lastWatermarkCheck.get(characterId)
      if (last !== undefined && nowMs - last < WATERMARK_CHECK_DEBOUNCE_MS) continue
      lastWatermarkCheck.set(characterId, nowMs)

      const unconsidered = await repos.memories.countUnconsideredHot(characterId)
      if (unconsidered <= settings.watermark) {
        log.debug('Consolidation watermark not reached', {
          characterId,
          unconsidered,
          watermark: settings.watermark,
        })
        continue
      }
      if (await ranRecently(characterId, nowMs)) {
        log.debug('Consolidation watermark reached but a recent run is inside the throttle window', {
          characterId,
          unconsidered,
          throttleMs: WATERMARK_RUN_THROTTLE_MS,
        })
        continue
      }
      const character = await repos.characters.findByIdRaw(characterId)
      if (!character || character.archivedAt) continue

      const { enqueueMemoryConsolidation } = await import('@/lib/background-jobs/queue-service')
      const jobId = await enqueueMemoryConsolidation(character.userId, { characterId, trigger: 'watermark' })
      enqueued.push(characterId)
      log.info('Consolidation watermark reached; run enqueued', {
        characterId,
        unconsidered,
        watermark: settings.watermark,
        jobId,
      })
    }
  } catch (error) {
    log.warn('Consolidation watermark check failed (non-fatal)', {
      characterIds,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return enqueued
}

/**
 * Dispatcher commit hook: after a job's batch commits, run the watermark check
 * for every character the batch wrote memories for. The consolidation job's
 * own digests never re-trigger it.
 */
export async function maybeEnqueueConsolidationAfterCommit(
  jobType: string | undefined,
  writes: readonly CommittedWrite[],
): Promise<void> {
  if (jobType === 'MEMORY_CONSOLIDATION') return
  const characterIds = characterIdsFromMemoryWrites(writes)
  if (characterIds.length === 0) return
  await maybeEnqueueConsolidationForCharacters(characterIds)
}

/**
 * The daily pass: enqueue a scheduled consolidation run for every live
 * character that holds memories and has at least a couple never considered.
 * Returns how many jobs were enqueued (0 when consolidation is disabled).
 */
export async function runScheduledConsolidation(): Promise<{ charactersEnqueued: number; charactersScanned: number }> {
  const result = { charactersEnqueued: 0, charactersScanned: 0 }
  const settings = await getMemoryConsolidationSettings()
  if (!settings.enabled) {
    log.debug('Scheduled consolidation skipped: disabled')
    return result
  }

  const repos = getRepositories()
  const { enqueueMemoryConsolidation } = await import('@/lib/background-jobs/queue-service')
  const characterIds = await repos.memories.findDistinctCharacterIds()
  for (const characterId of characterIds) {
    result.charactersScanned++
    try {
      const character = await repos.characters.findByIdRaw(characterId)
      if (!character || character.archivedAt) continue
      const unconsidered = await repos.memories.countUnconsideredHot(characterId)
      if (unconsidered < SCHEDULED_MIN_UNCONSIDERED) continue
      await enqueueMemoryConsolidation(character.userId, { characterId, trigger: 'scheduled' })
      result.charactersEnqueued++
    } catch (error) {
      log.warn('Failed to enqueue scheduled consolidation for character', {
        characterId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  log.info('Scheduled consolidation pass complete', result)
  return result
}
