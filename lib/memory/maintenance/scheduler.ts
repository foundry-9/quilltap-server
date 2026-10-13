/**
 * The daily maintenance sweep (memory refactor §3.9). Parent only.
 *
 * One scheduler owns the daily tick, the startup grace and the "a scheduled
 * run completed within 20 hours" startup skip. Each tick enqueues one
 * `MEMORY_MAINTENANCE` job per live character that holds memories; the job
 * resolves which phases its settings allow. The old 30-minute gap between
 * consolidation and housekeeping is simply phase order now.
 *
 * @module memory/maintenance/scheduler
 */

import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import { processSingleton } from '@/lib/utils/process-singleton'
import { resolveMemorySettings } from '../settings'

const log = logger.child({ module: 'memory:maintenance:scheduler' })

/** Run daily. */
export const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000

/** Wait this long after boot before the first tick, so the UI finishes compiling first. */
export const STARTUP_GRACE_MS = 5 * 60 * 1000

/** Skip the startup tick when a scheduled run completed this recently (dev restarts). */
export const RECENT_RUN_WINDOW_MS = 20 * 60 * 60 * 1000

const state = processSingleton('memory.maintenanceScheduler', () => ({
  interval: null as ReturnType<typeof setInterval> | null,
  running: false,
}))

/** Start the daily sweep. Idempotent. */
export function scheduleMemoryMaintenance(intervalMs: number = MAINTENANCE_INTERVAL_MS): void {
  if (state.running) return
  state.running = true
  state.interval = setInterval(() => {
    runScheduledMemoryMaintenance().catch((error) => {
      log.error('Scheduled maintenance tick failed', { error: error instanceof Error ? error.message : String(error) })
    })
  }, intervalMs)
  state.interval.unref?.()
  log.info('Maintenance scheduler started', { intervalMs, startupGraceMs: STARTUP_GRACE_MS })

  const startup = setTimeout(() => {
    runStartupTick().catch((error) => {
      log.error('Startup maintenance tick failed', { error: error instanceof Error ? error.message : String(error) })
    })
  }, STARTUP_GRACE_MS)
  startup.unref?.()
}

export function stopMemoryMaintenanceScheduler(): void {
  if (state.interval) clearInterval(state.interval)
  state.interval = null
  state.running = false
  log.info('Maintenance scheduler stopped')
}

export function isMemoryMaintenanceSchedulerRunning(): boolean {
  return state.running
}

/** The startup tick, skipped when a scheduled run completed within the window. */
export async function runStartupTick(nowMs: number = Date.now()): Promise<void> {
  try {
    const recent = await getRepositories().backgroundJobs.findRecentByType('MEMORY_MAINTENANCE', 50)
    const cutoff = nowMs - RECENT_RUN_WINDOW_MS
    const done = recent.find(
      (job) =>
        job.status === 'COMPLETED' &&
        (job.payload as Record<string, unknown> | undefined)?.reason === 'scheduled' &&
        Date.parse(job.updatedAt) >= cutoff,
    )
    if (done) {
      log.info('Skipping startup maintenance tick — a scheduled run completed recently', {
        jobId: done.id,
        completedAt: done.updatedAt,
      })
      return
    }
  } catch (error) {
    log.warn('Recent-run check failed; running the startup maintenance tick anyway', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
  await runScheduledMemoryMaintenance()
}

/**
 * One scheduled pass: a job per live character holding memories, when either
 * maintenance or consolidation is on. The enqueue dedupes per character, so the
 * sweep and a watermark run never work on one character at once (bug 221).
 */
export async function runScheduledMemoryMaintenance(): Promise<{ charactersScanned: number; jobsEnqueued: number }> {
  const result = { charactersScanned: 0, jobsEnqueued: 0 }
  const settings = await resolveMemorySettings()
  if (!settings.maintenance.enabled && !settings.maintenance.consolidation.enabled) {
    log.debug('Scheduled maintenance skipped: maintenance and consolidation are both off')
    return result
  }
  const repos = getRepositories()
  const { enqueueMemoryMaintenance } = await import('@/lib/background-jobs/queue-service')
  for (const characterId of await repos.memories.findDistinctCharacterIds()) {
    result.charactersScanned++
    try {
      const character = await repos.characters.findByIdRaw(characterId)
      if (!character || character.archivedAt) continue
      await enqueueMemoryMaintenance(character.userId, { characterId, reason: 'scheduled' })
      result.jobsEnqueued++
    } catch (error) {
      log.warn('Failed to enqueue scheduled maintenance for a character', {
        characterId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  log.info('Scheduled maintenance pass complete', result)
  return result
}
