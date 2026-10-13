'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { MAINTENANCE_PHASES, type MaintenancePhase, type MaintenanceReason, type MaintenanceSummary } from '@/lib/memory/maintenance/types'
import { PHASE_LABELS } from '@/components/memory/maintenance-report'
import { readErrorText } from './hooks/api-error-text'

/**
 * The maintenance ledger (`GET ?action=maintenance-status`): per character,
 * when each phase last ran and why, and what the last run did. The ledger
 * lives in the server's memory and is re-seeded from recent job rows at boot;
 * the `memories` realtime topic refreshes this read after a run commits.
 */

const STATUS_URL = '/api/v1/memories?action=maintenance-status'

interface LedgerStatus {
  characterId: string
  lastRun: Partial<Record<MaintenancePhase, { at: string; reason: MaintenanceReason }>>
  lastSummary: MaintenanceSummary | null
  lastDemotion: { at: string; demoted: number; excess: number; effective: boolean } | null
}

const REASON_TEXT: Record<MaintenanceReason, string> = {
  scheduled: 'daily round',
  watermark: 'nearing the cap',
  manual: 'by hand',
}

function when(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

/** One line on what the last run did, from its summary. */
export function summaryLine(summary: MaintenanceSummary): string {
  if (summary.skippedReason) return summary.skippedReason === 'archived' ? 'skipped: the character is archived' : 'skipped: character not found'
  const parts: string[] = []
  if (summary.fold) parts.push(`${summary.fold.folded} folded`)
  if (summary.consolidation) {
    const c = summary.consolidation
    parts.push(c.skippedReason ? `consolidation skipped (${c.skippedReason})` : `${c.digestsCreated + c.digestsUpdated} digests, ${c.membersSuperseded} superseded`)
  }
  if (summary.demote) parts.push(`${summary.demote.demoted} archived (${summary.demote.demotable}/${summary.demote.cap} counted)`)
  if (summary.retire) parts.push(`${summary.retire.retired} let go`)
  if (parts.length === 0) parts.push('nothing to do')
  return parts.join(' · ')
}

export function MemoryMaintenanceLedger({ characters }: { characters: Array<{ id: string; name: string }> }) {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.memories.maintenanceStatus,
    queryFn: ({ signal }) => apiFetch<{ ledger?: LedgerStatus[] }>(STATUS_URL, { signal }),
  })

  if (isLoading) return <p className="qt-text-small qt-text-muted">Opening the ledger&hellip;</p>
  if (error) return <p className="qt-text-small qt-text-destructive">{readErrorText(error, 'Failed to read the maintenance ledger')}</p>

  const names = new Map(characters.map((c) => [c.id, c.name]))
  const entries = (data?.ledger ?? []).filter((e) => e.lastSummary || Object.keys(e.lastRun).length > 0)
  if (entries.length === 0) {
    return <p className="qt-text-small qt-text-muted">The ledger is blank: no round has been recorded since the house last opened its doors.</p>
  }

  return (
    <div className="space-y-3">
      {entries.map((entry) => (
        <div key={entry.characterId} className="qt-card space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="qt-text-label">{names.get(entry.characterId) ?? entry.characterId.slice(0, 8)}</p>
            {entry.lastSummary && (
              <p className="qt-text-xs qt-text-muted">
                last {entry.lastSummary.dryRun ? 'rehearsal' : 'run'} {when(entry.lastSummary.finishedAt)} ({REASON_TEXT[entry.lastSummary.reason]})
              </p>
            )}
          </div>
          {entry.lastSummary && <p className="qt-text-small">{summaryLine(entry.lastSummary)}</p>}
          <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {MAINTENANCE_PHASES.map((phase) => {
              const run = entry.lastRun[phase]
              return (
                <li key={phase} className="qt-text-xs flex justify-between gap-2">
                  <span className="qt-text-muted">{PHASE_LABELS[phase]}</span>
                  <span>{run ? `${when(run.at)} · ${REASON_TEXT[run.reason]}` : 'never'}</span>
                </li>
              )
            })}
          </ul>
          {entry.lastDemotion && !entry.lastDemotion.effective && (
            <p className="qt-text-xs qt-text-warning">
              The last demotion moved too little of the excess to be worth repeating at once; automatic demotion rests for an hour after such a round.
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
