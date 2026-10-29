/**
 * The maintenance job's vocabulary (memory refactor §3.9).
 *
 * One job, `MEMORY_MAINTENANCE`, runs these phases for one character, in this
 * order, each skippable: fold near-duplicates → consolidate → demote → retire
 * → mirror. Pure types and constants; client-safe.
 *
 * @module memory/maintenance/types
 */

import type { MemoryConsolidationSettings } from '@/lib/schemas/settings.types'
import type { ConsolidationReport } from '../consolidation'

/** The phases, in the order they always run. */
export const MAINTENANCE_PHASES = ['fold-near-duplicates', 'consolidate', 'demote', 'retire', 'mirror'] as const

export type MaintenancePhase = (typeof MAINTENANCE_PHASES)[number]

/**
 * A hand-asked phase list with what it implies: the Commonplace mirror always
 * follows consolidation, so naming `consolidate` brings `mirror` with it.
 * Returned in {@link MAINTENANCE_PHASES} order.
 */
export function withImpliedPhases(phases: readonly MaintenancePhase[]): MaintenancePhase[] {
  const asked = new Set(phases)
  if (asked.has('consolidate')) asked.add('mirror')
  return MAINTENANCE_PHASES.filter((phase) => asked.has(phase))
}

/** Why a run was asked for (for the ledger and logs; exemption is per phase, `exemptPhases`). */
export type MaintenanceReason = 'scheduled' | 'watermark' | 'manual'

export interface MaintenanceRequest {
  characterId: string
  /** The phases asked for; omitted, all of them. Always run in {@link MAINTENANCE_PHASES} order. */
  phases?: readonly MaintenancePhase[]
  reason: MaintenanceReason
  /**
   * Phases asked for by hand: they run whatever the enabled switches and the
   * per-phase toggles say. Every other phase obeys them. Omitted, a manual
   * request exempts the phases it names (all of them when it names none) and
   * an automatic one exempts nothing.
   */
  exemptPhases?: readonly MaintenancePhase[]
  /** Plan every phase and write nothing. */
  dryRun?: boolean
  /** Per-run overrides. */
  settings?: MaintenanceRunSettings
}

/** What a single run may override. */
export interface MaintenanceRunSettings {
  /** Consolidation knobs for this run (a dry run's tuning; bug 223's threshold). */
  consolidation?: Partial<MemoryConsolidationSettings>
  /** Most clusters consolidated in this run. */
  maxClustersPerRun?: number
  /** The demotable-row cap for this run; otherwise the character's own (override → global). */
  cap?: number
}

/** Ambient context for a run: who pays for embeddings and model calls, and the clock. */
export interface MaintenanceContext {
  /** Defaults to the character's owner. */
  userId?: string
  /** Stop issuing consolidation model calls after this long (ms). */
  timeBudgetMs?: number
  /** Clock override for tests. */
  now?: Date
}

export type PhaseStatus = 'ran' | 'skipped'

/** Why a phase did not run. */
export type PhaseSkipReason =
  | 'not-requested'
  | 'maintenance-disabled'
  | 'consolidation-disabled'
  | 'phase-disabled'
  | 'no-retention-window'
  | 'nothing-touched'

export interface PhaseOutcome {
  phase: MaintenancePhase
  status: PhaseStatus
  skippedBecause?: PhaseSkipReason
  durationMs: number
}

/** One near-duplicate group: a survivor and the rows folded into it. */
export interface NearDuplicateGroup {
  survivorId: string
  absorbedIds: string[]
  /** The lowest cosine between the survivor and a row it absorbs. */
  minCosine: number
}

export interface FoldPhaseReport {
  /** Groups left for a later run because the fold's time budget ran out. */
  groupsDeferred: number
  /** Hot AUTO rows with an embedding — the only rows the phase considers. */
  eligible: number
  /** Eligible rows left uncompared this run because their bucket was over the comparison bound. */
  deferred: number
  groups: NearDuplicateGroup[]
  /** Rows folded away (retired once their survivor took them in). */
  folded: number
  /** Groups whose fold did not land (the survivor vanished, say); their rows were kept. */
  groupsFailed: number
}

export interface DemotePhaseReport {
  cap: number
  /** Hot rows before the phase (demotable + protected). */
  hotTotal: number
  /** Hot AUTO rows before the phase — the only rows the cap measures (bug 210). */
  demotable: number
  /** Hot MANUAL rows, digests and keystones — never demoted, never counted. */
  protected: number
  /** `max(0, demotable − cap)`. */
  excess: number
  demoted: number
  demotedIds: string[]
  /** Protection score of the last row demoted (the highest that went). */
  highestScoreDemoted: number | null
}

export interface RetirePhaseReport {
  retentionDays: number
  retired: number
  retiredIds: string[]
}

export interface MirrorPhaseReport {
  /** Subject buckets whose Commonplace file the run changed. */
  subjects: string[]
  filesWritten: number
  /** True in the job child: the parent's commit hook writes the files. */
  deferredToCommit: boolean
}

export interface MaintenanceReport {
  characterId: string
  characterName: string | null
  reason: MaintenanceReason
  dryRun: boolean
  startedAt: string
  finishedAt: string
  durationMs: number
  /** Set when nothing ran at all, and why. */
  skippedReason?: 'character-not-found' | 'archived'
  /** Every phase, in order, with whether it ran. */
  phases: PhaseOutcome[]
  fold?: FoldPhaseReport
  consolidation?: ConsolidationReport
  demote?: DemotePhaseReport
  retire?: RetirePhaseReport
  mirror?: MirrorPhaseReport
}

/**
 * A report without row contents: what a job hands its parent and what the
 * ledger keeps. Structured-clone safe.
 */
export interface MaintenanceSummary {
  characterId: string
  reason: MaintenanceReason
  dryRun: boolean
  finishedAt: string
  durationMs: number
  skippedReason?: MaintenanceReport['skippedReason']
  phases: PhaseOutcome[]
  fold?: { eligible: number; groups: number; folded: number; groupsFailed: number; groupsDeferred: number }
  consolidation?: {
    digestsCreated: number
    digestsUpdated: number
    membersSuperseded: number
    clustersFailed: number
    clustersDeferred: number
    skippedReason?: string
  }
  demote?: Omit<DemotePhaseReport, 'demotedIds'>
  retire?: { retentionDays: number; retired: number }
  mirror?: { subjects: number; filesWritten: number; deferredToCommit: boolean }
}
