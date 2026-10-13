/**
 * The maintenance ledger — in the parent, where every trigger decision is made
 * (memory refactor §3.9).
 *
 * One record per character: the last run of each phase, the last demotion's
 * effectiveness, and the watermark debounce. It replaces the job child's
 * housekeeping outcome cache, consolidation's parent-side debounce map, and
 * the four throttles that sat between them; {@link shouldEnqueue} is the one
 * question every trigger asks.
 *
 * In-memory by design. A restart forgets it; the first question after a boot
 * seeds it once from the recent `MEMORY_MAINTENANCE` job rows, so a restart
 * does not unleash a storm of watermark runs on a character that was just
 * maintained.
 *
 * Parent only: nothing in the job child reads or writes it (the child hands its
 * report back with the job result, and the commit hook records it here).
 *
 * @module memory/maintenance/ledger
 */

import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import { processSingleton } from '@/lib/utils/process-singleton'
import { MAINTENANCE_PHASES, type MaintenancePhase, type MaintenanceReason, type MaintenanceSummary } from './types'

const log = logger.child({ module: 'memory:maintenance:ledger' })

/** Fraction of the per-character cap at which the cap watermark trips. */
export const CAP_WATERMARK_FRACTION = 0.9

/** Minimum gap between two watermark checks for one character (each check is two COUNTs). */
export const WATERMARK_CHECK_DEBOUNCE_MS = 2 * 60 * 1000

/** A cap-driven run is not re-enqueued while the last demotion is younger than this. */
export const DEMOTE_THROTTLE_MS = 15 * 60 * 1000

/** …nor for this long after a demotion that was practically ineffective. */
export const INEFFECTIVE_BACKOFF_MS = 60 * 60 * 1000

/** A watermark consolidation is not re-enqueued while the last one is younger than this. */
export const CONSOLIDATE_THROTTLE_MS = 6 * 60 * 60 * 1000

/** A demotion is effective when it moved at least this many rows… */
const MIN_EFFECTIVE_DEMOTIONS = 10
/** …or this fraction of the excess, whichever is larger. */
const EXCESS_RATIO_THRESHOLD = 0.01

export interface PhaseRecord {
  at: number
  reason: MaintenanceReason
}

export interface LedgerEntry {
  /** When each phase last ran (live runs only). */
  lastRun: Partial<Record<MaintenancePhase, PhaseRecord>>
  /** The last run's summary, as reported. */
  lastSummary: MaintenanceSummary | null
  /** The last demotion: how many it moved against how far over the cap it was. */
  lastDemotion: { at: number; demoted: number; excess: number } | null
  /** When a watermark run asking for each phase was last enqueued. */
  lastEnqueued: Partial<Record<MaintenancePhase, number>>
  /** When the watermark last looked at this character. */
  lastWatermarkCheck: number | null
}

interface LedgerState {
  entries: Map<string, LedgerEntry>
  seeded: boolean
  seeding: Promise<void> | null
}

const state = processSingleton('memory.maintenanceLedger', (): LedgerState => ({
  entries: new Map(),
  seeded: false,
  seeding: null,
}))

function entryFor(characterId: string): LedgerEntry {
  let entry = state.entries.get(characterId)
  if (!entry) {
    entry = { lastRun: {}, lastSummary: null, lastDemotion: null, lastEnqueued: {}, lastWatermarkCheck: null }
    state.entries.set(characterId, entry)
  }
  return entry
}

/** Test hook. */
export function resetMaintenanceLedgerForTests(): void {
  state.entries.clear()
  state.seeded = false
  state.seeding = null
}

/**
 * Seed the ledger once per process from recent maintenance jobs — the durable
 * floor under the in-memory record. A failed read leaves it unseeded and the
 * next question tries again.
 */
async function ensureSeeded(): Promise<void> {
  if (state.seeded) return
  state.seeding ??= (async () => {
    try {
      const recent = await getRepositories().backgroundJobs.findRecentByType('MEMORY_MAINTENANCE', 100)
      for (const job of recent) {
        if (job.status !== 'COMPLETED' && job.status !== 'PROCESSING') continue
        const payload = (job.payload ?? {}) as Record<string, unknown>
        const characterId = payload.characterId
        if (typeof characterId !== 'string' || !characterId) continue
        const at = Date.parse(job.updatedAt)
        if (!Number.isFinite(at)) continue
        const reason = (payload.reason as MaintenanceReason | undefined) ?? 'manual'
        const phases = Array.isArray(payload.phases) ? (payload.phases as MaintenancePhase[]) : [...MAINTENANCE_PHASES]
        const entry = entryFor(characterId)
        for (const phase of phases) {
          const prior = entry.lastRun[phase]
          if (!prior || prior.at < at) entry.lastRun[phase] = { at, reason }
        }
      }
      state.seeded = true
      log.debug('Maintenance ledger seeded from recent jobs', { jobs: recent.length, characters: state.entries.size })
    } catch (error) {
      log.warn('Maintenance ledger could not seed from recent jobs', {
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      state.seeding = null
    }
  })()
  await state.seeding
}

/** Record a finished live run. Dry runs and skipped runs change nothing. */
export function recordMaintenanceOutcome(summary: MaintenanceSummary): void {
  if (summary.dryRun || summary.skippedReason) return
  const entry = entryFor(summary.characterId)
  const at = Date.parse(summary.finishedAt) || Date.now()
  for (const outcome of summary.phases) {
    if (outcome.status === 'ran') entry.lastRun[outcome.phase] = { at, reason: summary.reason }
  }
  entry.lastSummary = summary
  if (summary.demote) {
    entry.lastDemotion = { at, demoted: summary.demote.demoted, excess: summary.demote.excess }
  }
  log.debug('Maintenance outcome recorded', {
    characterId: summary.characterId,
    reason: summary.reason,
    ran: summary.phases.filter((p) => p.status === 'ran').map((p) => p.phase),
    demoted: summary.demote?.demoted ?? null,
  })
}

/** What the watermark measured for one character. */
export interface WatermarkReading {
  /** Hot AUTO rows (what the cap measures). */
  demotable: number
  cap: number
  /** Hot, never-considered, non-digest rows. */
  unconsidered: number
  consolidationWatermark: number
  maintenanceEnabled: boolean
  consolidationEnabled: boolean
}

/**
 * True when the last demotion moved too few rows to be worth repeating soon.
 * That includes a demotion with nothing to move: a character between 90% and
 * 100% of its cap trips the watermark on every insert, and a run that finds
 * no excess has nothing to do there for the next hour either.
 */
function lastDemotionIneffective(entry: LedgerEntry, nowMs: number): boolean {
  const last = entry.lastDemotion
  if (!last || nowMs - last.at >= INEFFECTIVE_BACKOFF_MS) return false
  const needed = Math.max(MIN_EFFECTIVE_DEMOTIONS, Math.floor(last.excess * EXCESS_RATIO_THRESHOLD))
  return last.demoted < needed
}

/** True when the phase ran, or a run asking for it was enqueued, inside the window. */
function ranWithin(entry: LedgerEntry, phase: MaintenancePhase, windowMs: number, nowMs: number): boolean {
  const last = Math.max(entry.lastRun[phase]?.at ?? -Infinity, entry.lastEnqueued[phase] ?? -Infinity)
  return nowMs - last < windowMs
}

/**
 * The one trigger question: should a run be enqueued for this character, and
 * with which phases? Returns null when nothing is due.
 *
 * - `scheduled`: every phase the settings allow; the job resolves the rest.
 * - `manual`: always due; the request names its phases.
 * - `watermark`: needs a `reading`. The cap watermark (demotable ≥ 90% of the
 *   cap) asks for fold → demote → retire unless a demotion ran in the last 15
 *   minutes or the last one was ineffective within the hour; the consolidation
 *   watermark (unconsidered > `watermark`) asks for consolidate unless one ran
 *   in the last six hours. The mirror rides with consolidate.
 */
export async function shouldEnqueue(
  characterId: string,
  reason: MaintenanceReason,
  reading?: WatermarkReading,
  nowMs: number = Date.now(),
): Promise<MaintenancePhase[] | null> {
  if (reason !== 'watermark') return [...MAINTENANCE_PHASES]
  if (!reading) return null
  await ensureSeeded()
  const entry = entryFor(characterId)
  const phases = new Set<MaintenancePhase>()

  if (reading.maintenanceEnabled && reading.demotable >= Math.floor(reading.cap * CAP_WATERMARK_FRACTION)) {
    if (ranWithin(entry, 'demote', DEMOTE_THROTTLE_MS, nowMs)) {
      log.debug('Cap watermark reached but a demotion ran recently', { characterId, demotable: reading.demotable, cap: reading.cap })
    } else if (lastDemotionIneffective(entry, nowMs)) {
      log.debug('Cap watermark reached but the last demotion was ineffective; backing off', {
        characterId,
        lastDemotion: entry.lastDemotion,
      })
    } else {
      phases.add('fold-near-duplicates').add('demote').add('retire')
    }
  }
  if (reading.consolidationEnabled && reading.unconsidered > reading.consolidationWatermark) {
    if (ranWithin(entry, 'consolidate', CONSOLIDATE_THROTTLE_MS, nowMs)) {
      log.debug('Consolidation watermark reached but a consolidation ran recently', {
        characterId,
        unconsidered: reading.unconsidered,
      })
    } else {
      phases.add('consolidate').add('mirror')
    }
  }
  return phases.size > 0 ? MAINTENANCE_PHASES.filter((p) => phases.has(p)) : null
}

/**
 * Debounce for the watermark: true (and stamped) when this character may be
 * measured now.
 */
export function takeWatermarkCheck(characterId: string, nowMs: number = Date.now()): boolean {
  const entry = entryFor(characterId)
  if (entry.lastWatermarkCheck !== null && nowMs - entry.lastWatermarkCheck < WATERMARK_CHECK_DEBOUNCE_MS) return false
  entry.lastWatermarkCheck = nowMs
  return true
}

/** A watermark run of `phases` has been enqueued: its throttles start now. */
export function noteEnqueued(characterId: string, phases: readonly MaintenancePhase[], nowMs: number = Date.now()): void {
  const entry = entryFor(characterId)
  for (const phase of phases) entry.lastEnqueued[phase] = nowMs
}

/** The ledger as the status surfaces show it. */
export interface LedgerStatus {
  characterId: string
  lastRun: Partial<Record<MaintenancePhase, { at: string; reason: MaintenanceReason }>>
  lastSummary: MaintenanceSummary | null
  lastDemotion: { at: string; demoted: number; excess: number; effective: boolean } | null
}

export async function getMaintenanceLedgerStatus(characterId?: string): Promise<LedgerStatus[]> {
  await ensureSeeded()
  const nowMs = Date.now()
  const ids = characterId ? [characterId] : Array.from(state.entries.keys())
  return ids.map((id) => {
    const entry = state.entries.get(id) ?? { lastRun: {}, lastSummary: null, lastDemotion: null, lastEnqueued: {}, lastWatermarkCheck: null }
    const lastRun: LedgerStatus['lastRun'] = {}
    for (const [phase, record] of Object.entries(entry.lastRun) as Array<[MaintenancePhase, PhaseRecord]>) {
      lastRun[phase] = { at: new Date(record.at).toISOString(), reason: record.reason }
    }
    return {
      characterId: id,
      lastRun,
      lastSummary: entry.lastSummary,
      lastDemotion: entry.lastDemotion
        ? {
            at: new Date(entry.lastDemotion.at).toISOString(),
            demoted: entry.lastDemotion.demoted,
            excess: entry.lastDemotion.excess,
            effective: !lastDemotionIneffective(entry, Math.min(nowMs, entry.lastDemotion.at)),
          }
        : null,
    }
  })
}
