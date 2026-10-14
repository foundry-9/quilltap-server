/**
 * `runMaintenance` — the one maintenance run for one character (memory
 * refactor §3.9).
 *
 * Reads the character's corpus once, then runs the phases in their fixed order
 * — fold near-duplicates → consolidate → demote → retire → mirror — each
 * planning against the corpus as the earlier ones left it. A dry run plans
 * every phase the same way and writes nothing (invariant 10).
 *
 * **Where the writes land.** In the job child (the `MEMORY_MAINTENANCE`
 * handler) the consolidation, demotion and retirement writes buffer and commit
 * with the job; the near-duplicate fold goes to the parent over host-RPC, under
 * admission's lock. In the parent (a manual run from the Memories API) every
 * write lands as it is made.
 *
 * **All effects after commit.** In the child this run announces nothing: the
 * dispatcher's commit hook invalidates the frozen archives, publishes
 * `memories`, writes the `Commonplace/` mirror from the committed rows (bug
 * 208) and records the outcome in the parent's ledger. In the parent the
 * writes have already committed when the run finishes, so it does the same
 * itself ({@link announceMaintenance}).
 *
 * @module memory/maintenance/run
 */

import type { Character } from '@/lib/schemas/types'
import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import { publishRealtime } from '@/lib/realtime/bus'
import { memoryIndex } from '../index-store'
import { retireMemories } from '../retire'
import { invalidateFrozenArchive } from '../recall/archive'
import { mirrorCommonplaceForSubjects } from '../commonplace-mirror'
import { resolveMemorySettings, type MemorySettings } from '../settings'
import { admissionThresholdsForProvider } from '../settings-defaults'
import { MaintenanceCorpus } from './corpus'
import { applyFoldsToCorpus, foldNearDuplicateGroups, planNearDuplicateFolds } from './fold-near-duplicates'
import { runConsolidatePhase } from './consolidate'
import { planDemotion, planRetention } from './demote'
import { recordMaintenanceOutcome } from './ledger'
import {
  MAINTENANCE_PHASES,
  type MaintenanceContext,
  type MaintenancePhase,
  type MaintenanceReport,
  type MaintenanceRequest,
  type MaintenanceSummary,
  type PhaseOutcome,
  type PhaseSkipReason,
} from './types'

const log = logger.child({ module: 'memory:maintenance' })

/** The share of a run's time budget the near-duplicate fold may spend; consolidation gets the rest. */
export const FOLD_BUDGET_SHARE = 0.4

function isJobChild(): boolean {
  return process.env.QUILLTAP_JOB_CHILD === '1'
}

/** The phases a request exempts from the switches (see `MaintenanceRequest.exemptPhases`). */
export function exemptPhasesFor(
  request: Pick<MaintenanceRequest, 'phases' | 'reason' | 'exemptPhases'>,
): Set<MaintenancePhase> {
  if (request.exemptPhases) return new Set(request.exemptPhases)
  if (request.reason !== 'manual') return new Set()
  return new Set(request.phases && request.phases.length > 0 ? request.phases : MAINTENANCE_PHASES)
}

/**
 * Which phases run, and why the others do not. A phase asked for by hand
 * (exempt) runs whatever the enabled switches and per-phase toggles say;
 * every other phase — anything a scheduled or watermark request asked for,
 * even when merged into a manual job — obeys them. `retire` always needs a
 * retention window.
 */
export function resolvePhases(
  request: Pick<MaintenanceRequest, 'phases' | 'reason' | 'exemptPhases'>,
  settings: Pick<MemorySettings, 'maintenance'>,
): Map<MaintenancePhase, PhaseSkipReason | null> {
  const explicit = request.phases && request.phases.length > 0 ? new Set(request.phases) : null
  const exempt = exemptPhasesFor(request)
  const m = settings.maintenance
  const toggles = m.phases
  const out = new Map<MaintenancePhase, PhaseSkipReason | null>()
  for (const phase of MAINTENANCE_PHASES) {
    let skip: PhaseSkipReason | null = null
    if (explicit && !explicit.has(phase)) {
      skip = 'not-requested'
    } else if (phase === 'consolidate') {
      if (!exempt.has(phase) && !m.consolidation.enabled) skip = 'consolidation-disabled'
    } else if (phase !== 'mirror') {
      if (!exempt.has(phase)) {
        const on =
          phase === 'fold-near-duplicates' ? toggles.foldNearDuplicates : phase === 'demote' ? toggles.demote : toggles.retire
        if (!m.enabled) skip = 'maintenance-disabled'
        else if (!on) skip = 'phase-disabled'
      }
      if (!skip && phase === 'retire' && !(m.coldRetentionDays && m.coldRetentionDays > 0)) skip = 'no-retention-window'
    }
    out.set(phase, skip)
  }
  return out
}

/** The report without row contents, for the job result and the ledger. */
export function summarizeMaintenance(report: MaintenanceReport): MaintenanceSummary {
  const c = report.consolidation
  return {
    characterId: report.characterId,
    reason: report.reason,
    dryRun: report.dryRun,
    finishedAt: report.finishedAt,
    durationMs: report.durationMs,
    ...(report.skippedReason ? { skippedReason: report.skippedReason } : {}),
    phases: report.phases,
    ...(report.fold
      ? {
          fold: {
            eligible: report.fold.eligible,
            groups: report.fold.groups.length,
            folded: report.fold.folded,
            groupsFailed: report.fold.groupsFailed,
            groupsDeferred: report.fold.groupsDeferred,
          },
        }
      : {}),
    ...(c
      ? {
          consolidation: {
            digestsCreated: c.stats.digestsCreated,
            digestsUpdated: c.stats.digestsUpdated,
            membersSuperseded: c.stats.membersSuperseded,
            clustersFailed: c.stats.clustersFailed,
            clustersDeferred: c.stats.clustersDeferred,
            ...(c.skippedReason ? { skippedReason: c.skippedReason } : {}),
          },
        }
      : {}),
    ...(report.demote ? { demote: (({ demotedIds: _ids, ...rest }) => rest)(report.demote) } : {}),
    ...(report.retire ? { retire: { retentionDays: report.retire.retentionDays, retired: report.retire.retired } } : {}),
    ...(report.mirror
      ? {
          mirror: {
            subjects: report.mirror.subjects.length,
            filesWritten: report.mirror.filesWritten,
            deferredToCommit: report.mirror.deferredToCommit,
          },
        }
      : {}),
  }
}

/** True when a live run changed rows. */
function changedRows(report: MaintenanceReport): boolean {
  const c = report.consolidation?.stats
  return (
    (report.fold?.folded ?? 0) > 0 ||
    (c ? c.digestsCreated + c.digestsUpdated + c.membersSuperseded + c.rowsMarkedConsidered : 0) > 0 ||
    (report.demote?.demoted ?? 0) > 0 ||
    (report.retire?.retired ?? 0) > 0
  )
}

/**
 * The effects of a live run whose writes have committed: drop the frozen
 * archives, publish the realtime hints, record the outcome. Parent only — the
 * job's commit hook calls it for a child run; an in-process run calls it
 * itself. Never throws.
 */
export function announceMaintenance(summary: MaintenanceSummary, opts: { rowsChanged: boolean; mirrored: boolean }): void {
  if (isJobChild() || summary.dryRun) return
  try {
    if (opts.rowsChanged) {
      invalidateFrozenArchive(summary.characterId)
      publishRealtime('memories')
    }
    if (opts.mirrored) publishRealtime('mountPoints')
    recordMaintenanceOutcome(summary)
  } catch (error) {
    log.warn('Maintenance announce failed (non-fatal)', {
      characterId: summary.characterId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** Run maintenance for one character. Throws only when its corpus cannot be read. */
export async function runMaintenance(
  request: MaintenanceRequest,
  ctx: MaintenanceContext = {},
): Promise<MaintenanceReport> {
  const startedMs = Date.now()
  const now = ctx.now ?? new Date()
  const nowMs = now.getTime()
  const dryRun = request.dryRun === true
  const { characterId, reason } = request
  const phases: PhaseOutcome[] = []
  const report: MaintenanceReport = {
    characterId,
    characterName: null,
    reason,
    dryRun,
    startedAt: now.toISOString(),
    finishedAt: now.toISOString(),
    durationMs: 0,
    phases,
  }
  const finish = (): MaintenanceReport => {
    report.finishedAt = new Date().toISOString()
    report.durationMs = Date.now() - startedMs
    return report
  }

  // Raw read on purpose: the archived tombstone lives on the row, and a broken
  // vault must not hide a character that still holds memories.
  const repos = getRepositories()
  const holderRaw = await repos.characters.findByIdRaw(characterId)
  if (!holderRaw || holderRaw.archivedAt) {
    report.skippedReason = holderRaw ? 'archived' : 'character-not-found'
    report.characterName = holderRaw?.name ?? null
    for (const phase of MAINTENANCE_PHASES) phases.push({ phase, status: 'skipped', durationMs: 0 })
    log.info('Maintenance skipped', { characterId, reason, skippedReason: report.skippedReason })
    return finish()
  }
  report.characterName = holderRaw.name
  let holder: Character = holderRaw
  try {
    holder = (await repos.characters.findById(characterId)) ?? holderRaw
  } catch {
    holder = holderRaw
  }
  const userId = ctx.userId ?? holderRaw.userId

  const settings = await resolveMemorySettings(userId)
  if (request.settings?.consolidation) {
    settings.maintenance.consolidation = { ...settings.maintenance.consolidation, ...request.settings.consolidation }
  }
  const plan = resolvePhases(request, settings)
  const runs = (phase: MaintenancePhase) => plan.get(phase) === null

  log.debug('Maintenance starting', {
    characterId,
    reason,
    dryRun,
    phases: MAINTENANCE_PHASES.filter(runs),
  })

  const corpus = MAINTENANCE_PHASES.some((p) => p !== 'mirror' && runs(p))
    ? await MaintenanceCorpus.load(characterId)
    : new MaintenanceCorpus(characterId)

  const timed = async (phase: MaintenancePhase, body: () => Promise<void>): Promise<void> => {
    const skip = plan.get(phase) ?? null
    if (skip) {
      phases.push({ phase, status: 'skipped', skippedBecause: skip, durationMs: 0 })
      return
    }
    const t0 = Date.now()
    await body()
    phases.push({ phase, status: 'ran', durationMs: Date.now() - t0 })
  }

  // ── 1. Fold near-duplicates ─────────────────────────────────────────────
  await timed('fold-near-duplicates', async () => {
    // The vectors are the default profile's; fold on its scale (TF-IDF cosines run lower).
    let provider: string | null = null
    try {
      provider = (await repos.embeddingProfiles.findDefault(userId))?.provider ?? null
    } catch (error) {
      log.debug('Could not read the default embedding profile; folding on the neural scale', {
        characterId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    const planned = await planNearDuplicateFolds(corpus.all(), admissionThresholdsForProvider(provider), nowMs)
    const folding = planned.groups.reduce((n, g) => n + g.absorbedIds.length, 0)
    report.fold = {
      eligible: planned.eligible,
      deferred: planned.deferred,
      groups: planned.groups,
      folded: dryRun ? folding : 0,
      groupsFailed: 0,
      groupsDeferred: 0,
    }
    if (dryRun || planned.groups.length === 0) {
      applyFoldsToCorpus(corpus, planned.groups, null)
      return
    }
    // Each group re-embeds its survivor; under a budget the fold gets its
    // share and leaves the rest of its groups for the next run.
    const deadlineAt = ctx.timeBudgetMs !== undefined ? startedMs + ctx.timeBudgetMs * FOLD_BUDGET_SHARE : undefined
    const applied = await foldNearDuplicateGroups({ characterId, groups: planned.groups, userId, deadlineAt })
    report.fold.folded = applied.retiredIds.length
    report.fold.groupsFailed = applied.groupsFailed
    report.fold.groupsDeferred = applied.groupsDeferred
    applyFoldsToCorpus(corpus, planned.groups, applied)
  })

  // ── 2. Consolidate ──────────────────────────────────────────────────────
  let touchedSubjects: string[] = []
  await timed('consolidate', async () => {
    const consolidation = settings.maintenance.consolidation
    const run = await runConsolidatePhase(corpus, holder, {
      dryRun,
      // Only this run's overrides: `consolidate` reads the stored settings
      // itself and picks the cluster threshold for the profile's scale unless
      // the run names one.
      settings: request.settings?.consolidation,
      maxClustersPerRun: request.settings?.maxClustersPerRun,
      userId,
      // What the run's budget has left after the fold.
      timeBudgetMs: ctx.timeBudgetMs !== undefined ? Math.max(0, ctx.timeBudgetMs - (Date.now() - startedMs)) : undefined,
      trigger: reason,
      now,
      matureAfterDays: consolidation.matureAfterDays,
    })
    report.consolidation = run.report
    touchedSubjects = run.touchedSubjects
  })

  // ── 3. Demote ───────────────────────────────────────────────────────────
  await timed('demote', async () => {
    const cap = request.settings?.cap ?? settings.maintenance.capFor(characterId)
    const demotion = planDemotion(corpus.all(), cap, nowMs)
    if (!dryRun && demotion.demotedIds.length > 0) {
      await memoryIndex.setTier(characterId, demotion.demotedIds, 'cold')
    }
    for (const id of demotion.demotedIds) corpus.patch(id, { tier: 'cold' })
    report.demote = demotion
    log.debug('Demotion planned', {
      characterId,
      cap,
      demotable: demotion.demotable,
      protected: demotion.protected,
      demoted: demotion.demoted,
      highestScoreDemoted: demotion.highestScoreDemoted,
    })
  })

  // ── 4. Retire ───────────────────────────────────────────────────────────
  await timed('retire', async () => {
    const retentionDays = settings.maintenance.coldRetentionDays as number
    const expired = planRetention(corpus.all(), retentionDays, nowMs)
    let retiredIds = expired
    if (!dryRun && expired.length > 0) {
      // Retention never takes a digest with its last member.
      retiredIds = (await retireMemories(expired, { reason: 'retention' })).retiredIds
    }
    corpus.remove(retiredIds)
    report.retire = { retentionDays, retired: retiredIds.length, retiredIds }
  })

  // ── 5. Mirror ───────────────────────────────────────────────────────────
  if (plan.get('mirror') === null && touchedSubjects.length === 0) plan.set('mirror', 'nothing-touched')
  await timed('mirror', async () => {
    const deferred = !dryRun && isJobChild()
    const filesWritten = dryRun || deferred ? 0 : await mirrorCommonplaceForSubjects(characterId, touchedSubjects, now.toISOString())
    report.mirror = { subjects: touchedSubjects, filesWritten, deferredToCommit: deferred }
    if (deferred) log.debug('Commonplace mirror deferred to the commit hook', { characterId, subjects: touchedSubjects.length })
  })

  finish()
  if (!dryRun && !isJobChild()) {
    announceMaintenance(summarizeMaintenance(report), {
      rowsChanged: changedRows(report),
      mirrored: (report.mirror?.filesWritten ?? 0) > 0,
    })
  }

  log.info('Maintenance run complete', {
    characterId,
    characterName: report.characterName,
    reason,
    dryRun,
    ran: phases.filter((p) => p.status === 'ran').map((p) => p.phase),
    folded: report.fold?.folded ?? null,
    digestsCreated: report.consolidation?.stats.digestsCreated ?? null,
    membersSuperseded: report.consolidation?.stats.membersSuperseded ?? null,
    demoted: report.demote?.demoted ?? null,
    retired: report.retire?.retired ?? null,
    durationMs: report.durationMs,
  })
  return report
}
