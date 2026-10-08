'use client'

import { createPortal } from 'react-dom'
import { Icon } from '@/components/ui/icon'
import type { ConsolidationReport, ConsolidationClusterReport } from '@/lib/memory/consolidation'

interface MemoryConsolidationReportDialogProps {
  report: ConsolidationReport
  onClose: () => void
}

const SKIPPED_TEXT: Record<NonNullable<ConsolidationReport['skippedReason']>, string> = {
  'character-not-found': 'The house has no record of that character.',
  archived: 'That character has been archived, and the archive is not to be disturbed.',
  'no-llm': 'No model is available to do the consolidating. Name a connection profile above, or configure the cheap LLM.',
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
        <p className="qt-text-label-xs qt-text-muted mb-1">
          Notes to be folded ({cluster.memberIds.length})
        </p>
        <ul className="space-y-1">
          {cluster.memberIds.map((id, i) => (
            <li key={id} className="qt-text-small">
              <span className={standalones.has(id) ? 'qt-text-warning' : undefined}>
                &bull; {cluster.memberContents[i]}
              </span>
              {standalones.has(id) && (
                <span className="qt-text-xs qt-text-muted"> (kept on the shelf as it is)</span>
              )}
            </li>
          ))}
        </ul>
      </div>

      {cluster.digests.length > 0 && (
        <div>
          <p className="qt-text-label-xs qt-text-muted mb-1">
            Proposed digest{cluster.digests.length === 1 ? '' : 's'}
          </p>
          <ul className="space-y-2">
            {cluster.digests.map((digest) => (
              <li key={digest.id} className="border-l-2 qt-border-default pl-3">
                <p className="qt-text-small">{digest.content}</p>
                <p className="qt-text-xs qt-text-muted">
                  {digest.action === 'update' ? 'revises an existing digest' : 'new digest'} &middot;{' '}
                  {digest.kind} &middot; importance {(digest.importance * 100).toFixed(0)}% &middot; from{' '}
                  {digest.memberIds.length} note{digest.memberIds.length === 1 ? '' : 's'}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {cluster.contradictions.length > 0 && (
        <div>
          <p className="qt-text-label-xs qt-text-warning mb-1">
            Contradictions noticed ({cluster.contradictions.length})
          </p>
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

/**
 * The consolidation report, shown after a dry run. Portalled to
 * document.body so the fixed overlay is not trapped under the workspace
 * toolbar's stacking context.
 */
export function MemoryConsolidationReportDialog({ report, onClose }: MemoryConsolidationReportDialogProps) {
  if (typeof document === 'undefined') return null
  const { stats } = report

  return createPortal(
    <div className="qt-dialog-overlay p-4 z-[100]">
      <div className="qt-dialog max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="qt-dialog-header">
          <div className="flex items-center justify-between">
            <h2 className="qt-dialog-title">
              {report.dryRun ? 'Consolidation, Rehearsed' : 'Consolidation Report'}
              {report.characterName ? ` — ${report.characterName}` : ''}
            </h2>
            <button type="button" onClick={onClose} className="qt-text-secondary hover:text-foreground" aria-label="Close">
              <Icon name="close" className="w-6 h-6" />
            </button>
          </div>
          <p className="qt-dialog-description">
            {report.dryRun
              ? 'Nothing has been written. This is what the Commonplace Book would do, were it let off the leash.'
              : 'The Commonplace Book has been at work.'}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {report.skippedReason && (
            <p className="qt-text-small qt-text-warning">{SKIPPED_TEXT[report.skippedReason]}</p>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Notes considered" value={stats.candidates} />
            <Stat label="Clusters found" value={stats.clustersFound} />
            <Stat label="Clusters attempted" value={stats.clustersAttempted} />
            <Stat label="Digests proposed" value={stats.digestsCreated + stats.digestsUpdated || report.clusters.reduce((n, c) => n + c.digests.length, 0)} />
          </div>
          <p className="qt-text-xs qt-text-muted">
            {stats.clustersDeferred > 0 && `${stats.clustersDeferred} further clusters wait for another run. `}
            {stats.immatureSkipped > 0 && `${stats.immatureSkipped} notes are too young to fold. `}
            {stats.noEmbeddingSkipped > 0 && `${stats.noEmbeddingSkipped} notes lack embeddings. `}
            {stats.budgetExhausted && 'The time budget ran out; the rest will keep. '}
            {(stats.durationMs / 1000).toFixed(1)}s.
          </p>

          {report.clusters.length === 0 && !report.skippedReason && (
            <p className="qt-text-small qt-text-muted">
              Not a single cluster worth folding. The shelves are in good order.
            </p>
          )}

          {report.clusters.map((cluster, i) => (
            <ClusterBlock key={`${cluster.bucket.kind}-${cluster.memberIds[0] ?? i}-${i}`} cluster={cluster} index={i} />
          ))}
        </div>

        <div className="qt-dialog-footer flex justify-end gap-2">
          <button type="button" onClick={onClose} className="qt-button qt-button-secondary">
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="qt-card text-center">
      <p className="text-2xl font-bold">{value}</p>
      <p className="qt-text-xs qt-text-muted">{label}</p>
    </div>
  )
}
