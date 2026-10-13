'use client'

import type { ConsolidationReport, ConsolidationClusterReport } from '@/lib/memory/consolidation'
import type { MaintenancePhase, MaintenanceReport, PhaseSkipReason } from '@/lib/memory/maintenance/types'

/**
 * What a maintenance run did (or, rehearsed, would do), phase by phase. One
 * view serves the Maintenance card and the character page's dialog; the
 * consolidation phase's clusters render as the old consolidation report did.
 */

export const PHASE_LABELS: Record<MaintenancePhase, string> = {
  'fold-near-duplicates': 'Fold near-duplicates',
  consolidate: 'Consolidate',
  demote: 'Demote over the cap',
  retire: 'Retire old archive notes',
  mirror: 'Refresh the Commonplace files',
}

const SKIP_TEXT: Record<PhaseSkipReason, string> = {
  'not-requested': 'not asked for',
  'maintenance-disabled': 'automatic maintenance is off',
  'consolidation-disabled': 'consolidation is off',
  'phase-disabled': 'switched off above',
  'no-retention-window': 'no archive retention window is set',
  'nothing-touched': 'nothing changed that it mirrors',
}

const REPORT_SKIP_TEXT: Record<NonNullable<MaintenanceReport['skippedReason']>, string> = {
  'character-not-found': 'The character could not be found.',
  archived: 'The character rests in the archive; nothing was done.',
}

const CONSOLIDATION_SKIP_TEXT: Record<NonNullable<ConsolidationReport['skippedReason']>, string> = {
  'no-llm': 'No model is available to do the consolidating. Name a connection profile, or configure the cheap LLM.',
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="qt-card text-center">
      <p className="text-2xl font-bold">{value}</p>
      <p className="qt-text-xs qt-text-muted">{label}</p>
    </div>
  )
}

function bucketLabel(cluster: ConsolidationClusterReport): string {
  switch (cluster.bucket.kind) {
    case 'self':
      return 'About themselves'
    case 'other':
      return `About ${cluster.bucket.subjectName}`
    default:
      return 'About no one in particular'
  }
}

function ClusterBlock({ cluster, index }: { cluster: ConsolidationClusterReport; index: number }) {
  const standalones = new Set(cluster.keepStandalone)
  return (
    <div className="qt-card space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="qt-text-label">
          Cluster {index + 1} &middot; {bucketLabel(cluster)} &middot; {cluster.clusterKind}
        </p>
        <span className="qt-text-xs qt-text-muted">{cluster.status}</span>
      </div>

      {cluster.error && <p className="qt-text-small qt-text-destructive">{cluster.error}</p>}

      <div>
        <p className="qt-text-label-xs qt-text-muted mb-1">Notes to be folded ({cluster.memberIds.length})</p>
        <ul className="space-y-1">
          {cluster.memberIds.map((id, i) => (
            <li key={id} className="qt-text-small">
              <span className={standalones.has(id) ? 'qt-text-warning' : undefined}>&bull; {cluster.memberContents[i]}</span>
              {standalones.has(id) && <span className="qt-text-xs qt-text-muted"> (kept on the shelf as it is)</span>}
            </li>
          ))}
        </ul>
      </div>

      {cluster.digests.length > 0 && (
        <div>
          <p className="qt-text-label-xs qt-text-muted mb-1">Proposed digest{cluster.digests.length === 1 ? '' : 's'}</p>
          <ul className="space-y-2">
            {cluster.digests.map((digest) => (
              <li key={digest.id} className="border-l-2 qt-border-default pl-3">
                <p className="qt-text-small">{digest.content}</p>
                <p className="qt-text-xs qt-text-muted">
                  {digest.action === 'update' ? 'revises an existing digest' : 'new digest'} &middot; {digest.kind} &middot;
                  importance {(digest.importance * 100).toFixed(0)}% &middot; from {digest.memberIds.length} note
                  {digest.memberIds.length === 1 ? '' : 's'}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {cluster.contradictions.length > 0 && (
        <div>
          <p className="qt-text-label-xs qt-text-warning mb-1">Contradictions noticed ({cluster.contradictions.length})</p>
          <ul className="space-y-1">
            {cluster.contradictions.map((c, i) => (
              <li key={`${c.olderId}-${c.newerId}-${i}`} className="qt-text-small">
                &bull; {c.note || 'A newer note displaces an older one.'}{' '}
                <span className="qt-text-xs qt-text-muted">
                  ({String(c.olderId).slice(0, 8)} superseded by {String(c.newerId).slice(0, 8)})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function ConsolidationSection({ report }: { report: ConsolidationReport }) {
  const { stats } = report
  const proposed = stats.digestsCreated + stats.digestsUpdated || report.clusters.reduce((n, c) => n + c.digests.length, 0)
  return (
    <div className="space-y-3">
      {report.skippedReason && <p className="qt-text-small qt-text-warning">{CONSOLIDATION_SKIP_TEXT[report.skippedReason]}</p>}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Notes considered" value={stats.candidates} />
        <Stat label="Clusters worth folding" value={stats.clustersQualified} />
        <Stat label="Clusters attempted" value={stats.clustersAttempted} />
        <Stat label="Digests proposed" value={proposed} />
      </div>
      <p className="qt-text-xs qt-text-muted">
        {stats.clustersDeferred > 0 && `${stats.clustersDeferred} further clusters wait for another run. `}
        {stats.immatureSkipped > 0 && `${stats.immatureSkipped} notes are too young to fold. `}
        {stats.noEmbeddingSkipped > 0 && `${stats.noEmbeddingSkipped} notes lack embeddings. `}
        {stats.budgetExhausted && 'The time budget ran out; the rest will keep. '}
        {(stats.durationMs / 1000).toFixed(1)}s.
      </p>
      {report.clusters.length === 0 && !report.skippedReason && (
        <p className="qt-text-small qt-text-muted">Not a single cluster worth folding. The shelves are in good order.</p>
      )}
      {report.clusters.map((cluster, i) => (
        <ClusterBlock key={`${cluster.bucket.kind}-${cluster.memberIds[0] ?? i}-${i}`} cluster={cluster} index={i} />
      ))}
    </div>
  )
}

/** One character's report: the phase ledger, then each phase that ran. */
export function MaintenanceReportView({ report }: { report: MaintenanceReport }) {
  if (report.skippedReason) {
    return <p className="qt-text-small qt-text-warning">{REPORT_SKIP_TEXT[report.skippedReason]}</p>
  }
  const { fold, demote, retire, mirror, consolidation } = report
  return (
    <div className="space-y-5">
      <ul className="space-y-1">
        {report.phases.map((outcome) => (
          <li key={outcome.phase} className="qt-text-small flex items-baseline justify-between gap-3">
            <span className={outcome.status === 'ran' ? undefined : 'qt-text-muted'}>{PHASE_LABELS[outcome.phase]}</span>
            <span className="qt-text-xs qt-text-muted">
              {outcome.status === 'ran'
                ? `${report.dryRun ? 'rehearsed' : 'ran'} · ${(outcome.durationMs / 1000).toFixed(1)}s`
                : `skipped — ${SKIP_TEXT[outcome.skippedBecause ?? 'not-requested']}`}
            </span>
          </li>
        ))}
      </ul>

      {fold && (
        <section className="space-y-2">
          <h3 className="qt-text-label">{PHASE_LABELS['fold-near-duplicates']}</h3>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Notes compared" value={fold.eligible} />
            <Stat label="Sets found" value={fold.groups.length} />
            <Stat label={report.dryRun ? 'Would fold' : 'Folded'} value={fold.folded} />
          </div>
          {(fold.deferred > 0 || fold.groupsDeferred > 0 || fold.groupsFailed > 0) && (
            <p className="qt-text-xs qt-text-muted">
              {fold.deferred > 0 && `${fold.deferred} notes wait for a later comparison. `}
              {fold.groupsDeferred > 0 && `${fold.groupsDeferred} sets wait for the next run. `}
              {fold.groupsFailed > 0 && `${fold.groupsFailed} sets could not be folded and were left as they were.`}
            </p>
          )}
        </section>
      )}

      {consolidation && (
        <section className="space-y-2">
          <h3 className="qt-text-label">{PHASE_LABELS.consolidate}</h3>
          <ConsolidationSection report={consolidation} />
        </section>
      )}

      {demote && (
        <section className="space-y-2">
          <h3 className="qt-text-label">{PHASE_LABELS.demote}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Cap" value={demote.cap.toLocaleString()} />
            <Stat label="Counted" value={demote.demotable.toLocaleString()} />
            <Stat label="Exempt" value={demote.protected.toLocaleString()} />
            <Stat label={report.dryRun ? 'Would archive' : 'Archived'} value={demote.demoted.toLocaleString()} />
          </div>
          <p className="qt-text-xs qt-text-muted">
            {demote.excess > 0
              ? `${demote.excess.toLocaleString()} counted notes over the cap; the least protected go to the archive first.`
              : 'Within the cap. Nothing need go to the archive.'}{' '}
            Hand-written notes and digests are never counted and never moved.
          </p>
        </section>
      )}

      {retire && (
        <section className="space-y-1">
          <h3 className="qt-text-label">{PHASE_LABELS.retire}</h3>
          <p className="qt-text-small">
            {retire.retired === 0
              ? `No superseded archive note is older than ${retire.retentionDays} days.`
              : `${retire.retired.toLocaleString()} superseded archive note${retire.retired === 1 ? '' : 's'} older than ${retire.retentionDays} days ${report.dryRun ? 'would be' : 'were'} let go.`}
          </p>
        </section>
      )}

      {mirror && mirror.subjects.length > 0 && (
        <section className="space-y-1">
          <h3 className="qt-text-label">{PHASE_LABELS.mirror}</h3>
          <p className="qt-text-small">
            {mirror.subjects.length} subject file{mirror.subjects.length === 1 ? '' : 's'}{' '}
            {report.dryRun ? 'would be refreshed' : mirror.deferredToCommit ? 'refreshed once the run is committed' : 'refreshed'}.
          </p>
        </section>
      )}
    </div>
  )
}

/** A user-wide dry run (LLM-free phases only): one row per character. */
export function MaintenanceReportsTable({ reports }: { reports: MaintenanceReport[] }) {
  const rows = reports.filter((r) => !r.skippedReason)
  if (rows.length === 0) {
    return <p className="qt-text-small qt-text-muted">No character has any memories to tend.</p>
  }
  return (
    <div className="max-h-80 overflow-y-auto border qt-border-default rounded-lg">
      <table className="w-full text-sm">
        <thead className="qt-bg-muted sticky top-0">
          <tr>
            <th className="text-left px-3 py-2 qt-text-secondary font-medium">Character</th>
            <th className="text-right px-3 py-2 qt-text-secondary font-medium">Would fold</th>
            <th className="text-right px-3 py-2 qt-text-secondary font-medium" title="Counted notes against the cap">Counted / cap</th>
            <th className="text-right px-3 py-2 qt-text-secondary font-medium">Would archive</th>
            <th className="text-right px-3 py-2 qt-text-secondary font-medium">Would let go</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.characterId}>
              <td className="px-3 py-2 text-foreground truncate max-w-[160px]">{r.characterName ?? 'Unnamed'}</td>
              <td className="text-right px-3 py-2">{r.fold ? r.fold.folded : '—'}</td>
              <td className={`text-right px-3 py-2 ${r.demote && r.demote.excess > 0 ? 'qt-text-destructive' : ''}`}>
                {r.demote ? `${r.demote.demotable.toLocaleString()} / ${r.demote.cap.toLocaleString()}` : '—'}
              </td>
              <td className="text-right px-3 py-2">{r.demote ? r.demote.demoted : '—'}</td>
              <td className="text-right px-3 py-2">{r.retire ? r.retire.retired : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
