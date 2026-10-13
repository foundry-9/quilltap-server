/**
 * When a `MEMORY_MAINTENANCE` job is enqueued — the watermark half. Parent only.
 *
 * Called after admission inserts a row (`admitPrepared`) and from the job
 * dispatcher's commit hook for any batch that created memory rows. It measures
 * the character (two COUNTs, debounced per character) and asks the ledger's
 * {@link shouldEnqueue} which phases are due; the daily sweep lives in
 * `scheduler.ts`.
 *
 * @module memory/maintenance/triggers
 */

import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import { resolveMemorySettings } from '../settings'
import { noteEnqueued, shouldEnqueue, takeWatermarkCheck } from './ledger'

const log = logger.child({ module: 'memory:maintenance:triggers' })

/** A buffered write as the dispatcher sees it. */
export interface CommittedWrite {
  method: string
  args: readonly unknown[]
}

/** The characters a committed batch wrote new memory rows for. */
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

/**
 * Watermark check for a set of characters; enqueues one run per character
 * whose watermarks say something is due. Never throws. Returns the characters
 * a run was enqueued for.
 */
export async function maybeEnqueueMaintenance(characterIds: readonly string[], nowMs: number = Date.now()): Promise<string[]> {
  const enqueued: string[] = []
  // The debounce first: most calls (one per inserted row) stop here, before any read.
  const due = characterIds.filter((id) => takeWatermarkCheck(id, nowMs))
  if (due.length === 0) return enqueued
  try {
    const settings = await resolveMemorySettings()
    const maintenanceEnabled = settings.maintenance.enabled
    const consolidationEnabled = settings.maintenance.consolidation.enabled
    if (!maintenanceEnabled && !consolidationEnabled) return enqueued

    const repos = getRepositories()
    for (const characterId of due) {
      const { demotable } = await repos.memories.countCapBreakdown(characterId)
      const unconsidered = consolidationEnabled ? await repos.memories.countUnconsideredHot(characterId) : 0
      const phases = await shouldEnqueue(
        characterId,
        'watermark',
        {
          demotable,
          cap: settings.maintenance.capFor(characterId),
          unconsidered,
          consolidationWatermark: settings.maintenance.consolidation.watermark,
          maintenanceEnabled,
          consolidationEnabled,
        },
        nowMs,
      )
      if (!phases) {
        log.debug('Maintenance watermarks not due', { characterId, demotable, unconsidered })
        continue
      }
      const character = await repos.characters.findByIdRaw(characterId)
      if (!character || character.archivedAt) continue

      const { enqueueMemoryMaintenance } = await import('@/lib/background-jobs/queue-service')
      const jobId = await enqueueMemoryMaintenance(character.userId, { characterId, reason: 'watermark', phases })
      // The id is always a waiting job carrying these phases (a running job
      // never absorbs a request), so the throttles may start now.
      noteEnqueued(characterId, phases, nowMs)
      enqueued.push(characterId)
      log.info('Maintenance watermark reached; run enqueued', { characterId, phases, demotable, unconsidered, jobId })
    }
  } catch (error) {
    log.warn('Maintenance watermark check failed (non-fatal)', {
      characterIds,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return enqueued
}

/**
 * Dispatcher commit hook: after a job's batch commits, run the watermark check
 * for every character the batch created memories for. A maintenance job's own
 * digests never re-trigger it.
 */
export async function maybeEnqueueMaintenanceAfterCommit(
  jobType: string | undefined,
  writes: readonly CommittedWrite[],
): Promise<void> {
  if (jobType === 'MEMORY_MAINTENANCE') return
  const characterIds = characterIdsFromMemoryWrites(writes)
  if (characterIds.length === 0) return
  await maybeEnqueueMaintenance(characterIds)
}
