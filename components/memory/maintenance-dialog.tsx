'use client'

import { useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Icon } from '@/components/ui/icon'
import { useDialogFocus } from '@/hooks/useDialogFocus'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { writeErrorText } from '@/components/tools/hooks/api-error-text'
import { MEMORY_CAP_BOUNDS } from '@/lib/memory/settings-defaults'
import { MAINTENANCE_PHASES, type MaintenancePhase, type MaintenanceReport } from '@/lib/memory/maintenance/types'
import { MaintenanceReportView, MaintenanceReportsTable, PHASE_LABELS } from './maintenance-report'

/**
 * "Run maintenance now": choose a character (or, from the settings card,
 * every one), choose the phases, rehearse with a dry run or queue the real
 * thing. One dialog for the Maintenance card and the character page's
 * Memories tab (`POST /api/v1/memories?action=maintain`).
 */

const MAINTAIN_URL = '/api/v1/memories?action=maintain'
const CHARACTER_MEMORY_COUNTS_URL = '/api/v1/memories?action=character-memory-counts'
const ALL = '__all__'

/** The phases a person picks; the mirror follows consolidation on its own. */
const PICKABLE_PHASES = MAINTENANCE_PHASES.filter((p): p is Exclude<MaintenancePhase, 'mirror'> => p !== 'mirror')

const PHASE_HINTS: Record<Exclude<MaintenancePhase, 'mirror'>, string> = {
  'fold-near-duplicates': 'Fold notes that say the same thing about the same occasion into the sturdiest of them. No model is consulted.',
  consolidate: 'Ask a model to fold clusters of related notes into digests; the originals go to the archive. Costs model calls.',
  demote: 'Send the least protected notes to the archive while a character holds more than the cap.',
  retire: 'Let go of superseded archive notes older than the retention window (when one is set).',
}

interface CharacterRow {
  id: string
  name: string
  demotable?: number
  memoryCount?: number
}

export interface MaintenanceDialogProps {
  /** Fixed to one character (the character page); omitted, the dialog offers a picker with "every character". */
  characterId?: string
  characterName?: string
  onClose: () => void
  /** After a real run is queued. */
  onQueued?: () => void
}

type Result = { kind: 'one'; report: MaintenanceReport } | { kind: 'many'; reports: MaintenanceReport[] }

export function MaintenanceDialog({ characterId, characterName, onClose, onQueued }: MaintenanceDialogProps) {
  const queryClient = useQueryClient()
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const handleFocusKeyDown = useDialogFocus(dialogRef, true)
  useEscapeKey(onClose, true)
  const [target, setTarget] = useState<string>(characterId ?? '')
  const [phases, setPhases] = useState<Set<MaintenancePhase>>(() => new Set(PICKABLE_PHASES))
  const [capDraft, setCapDraft] = useState('')
  const [running, setRunning] = useState<'dry' | 'real' | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: counts } = useQuery({
    queryKey: queryKeys.memories.characterMemoryCounts,
    queryFn: ({ signal }) => apiFetch<{ characters?: CharacterRow[] }>(CHARACTER_MEMORY_COUNTS_URL, { signal }),
    enabled: !characterId,
  })
  const characters = Array.isArray(counts?.characters) ? counts.characters : []

  const everyone = target === ALL
  const chosen = PICKABLE_PHASES.filter((p) => phases.has(p))
  const consolidating = phases.has('consolidate')
  // A dry run that would call the model names one character (the API refuses otherwise).
  const dryRunBlocked = everyone && consolidating
  const cap = capDraft.trim() === '' ? undefined : Math.floor(Number(capDraft))
  const capInvalid = cap !== undefined && (!Number.isFinite(cap) || cap < MEMORY_CAP_BOUNDS.min || cap > MEMORY_CAP_BOUNDS.max)
  const ready = target !== '' && chosen.length > 0 && !capInvalid && running === null

  const togglePhase = (phase: MaintenancePhase) => {
    setResult(null)
    setPhases((current) => {
      const next = new Set(current)
      if (next.has(phase)) next.delete(phase)
      else next.add(phase)
      return next
    })
  }

  const body = (dryRun: boolean) => ({
    ...(everyone ? {} : { characterId: target }),
    phases: chosen,
    dryRun,
    ...(cap !== undefined && phases.has('demote') ? { settings: { cap } } : {}),
  })

  const run = async (dryRun: boolean) => {
    setRunning(dryRun ? 'dry' : 'real')
    setError(null)
    try {
      const data = await apiFetch<{ report?: MaintenanceReport; reports?: MaintenanceReport[]; jobIds?: string[] }>(MAINTAIN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body(dryRun)),
      })
      if (dryRun) {
        if (data.report) setResult({ kind: 'one', report: data.report })
        else setResult({ kind: 'many', reports: data.reports ?? [] })
        return
      }
      const queued = data.jobIds?.length ?? 0
      showSuccessToast(
        everyone
          ? `The staff have been sent round to ${queued} character${queued === 1 ? '' : 's'}; the work proceeds below stairs.`
          : 'The staff have been sent round; the work proceeds below stairs.',
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.memories.maintenanceStatus })
      onQueued?.()
      onClose()
    } catch (err) {
      const msg = writeErrorText(err, dryRun ? 'The rehearsal failed' : 'Failed to queue maintenance')
      setError(msg)
      showErrorToast(msg)
    } finally {
      setRunning(null)
    }
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="qt-dialog-overlay p-4 z-[100]">
      <div
        className="qt-dialog max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleFocusKeyDown}
      >
        <div className="qt-dialog-header">
          <div className="flex items-center justify-between">
            <h2 id={titleId} className="qt-dialog-title">
              Memory Maintenance{characterName ? ` — ${characterName}` : ''}
            </h2>
            <button type="button" onClick={onClose} className="qt-text-secondary hover:text-foreground" aria-label="Close">
              <Icon name="close" className="w-6 h-6" />
            </button>
          </div>
          <p className="qt-dialog-description">
            Rehearse first, if you please: a dry run shows what each phase would do and writes not a word. The real run is
            queued in the background and goes ahead whatever the switches on the settings card say.
          </p>
        </div>

        <div className="qt-dialog-body border-b qt-border-default space-y-4">
          {!characterId && (
            <div className="space-y-1">
              <label htmlFor="maintenance-target" className="block qt-text-label">
                Character
              </label>
              <select
                id="maintenance-target"
                className="qt-select w-auto"
                value={target}
                disabled={running !== null}
                onChange={(e) => {
                  setTarget(e.target.value)
                  setResult(null)
                }}
              >
                <option value="">Choose a character&hellip;</option>
                <option value={ALL}>Every character</option>
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({(c.demotable ?? c.memoryCount ?? 0).toLocaleString()} counted)
                  </option>
                ))}
              </select>
            </div>
          )}

          <fieldset className="space-y-2">
            <legend className="qt-text-label mb-1">Phases</legend>
            {PICKABLE_PHASES.map((phase) => (
              <label key={phase} className="flex items-start gap-3 qt-body">
                <input
                  type="checkbox"
                  className="qt-checkbox mt-1"
                  checked={phases.has(phase)}
                  disabled={running !== null}
                  onChange={() => togglePhase(phase)}
                />
                <span>
                  <span>{PHASE_LABELS[phase]}</span>
                  <span className="block qt-text-xs qt-text-muted">{PHASE_HINTS[phase]}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {phases.has('demote') && (
            <div className="space-y-1">
              <label htmlFor="maintenance-cap" className="block qt-text-label">
                Cap for this run
              </label>
              <input
                id="maintenance-cap"
                type="number"
                min={MEMORY_CAP_BOUNDS.min}
                max={MEMORY_CAP_BOUNDS.max}
                step={100}
                placeholder="the configured cap"
                value={capDraft}
                disabled={running !== null}
                onChange={(e) => {
                  setCapDraft(e.target.value)
                  setResult(null)
                }}
                className="qt-input w-40"
              />
              <p className="qt-text-xs qt-text-muted">
                {capInvalid
                  ? `Between ${MEMORY_CAP_BOUNDS.min.toLocaleString()} and ${MEMORY_CAP_BOUNDS.max.toLocaleString()}, if you please.`
                  : 'Leave blank to use each character’s own cap (its override, else the global one).'}
              </p>
            </div>
          )}

          {dryRunBlocked && (
            <p className="qt-text-xs qt-text-warning">
              Consolidation calls a model, so it can be rehearsed for one character at a time.
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {error && <p className="qt-text-small qt-text-destructive mb-4">{error}</p>}
          {running === 'dry' && <p className="qt-text-small qt-text-muted">Rehearsing&hellip;</p>}
          {running === null && result?.kind === 'one' && <MaintenanceReportView report={result.report} />}
          {running === null && result?.kind === 'many' && <MaintenanceReportsTable reports={result.reports} />}
          {running === null && !result && !error && (
            <p className="qt-text-small qt-text-muted">Choose the phases, then rehearse or send for the staff.</p>
          )}
        </div>

        <div className="qt-dialog-footer flex justify-end gap-2">
          <button type="button" onClick={onClose} className="qt-button qt-button-secondary">
            Close
          </button>
          <button
            type="button"
            className="qt-button qt-button-secondary"
            disabled={!ready || dryRunBlocked}
            onClick={() => void run(true)}
          >
            {running === 'dry' ? 'Rehearsing…' : 'Dry run'}
          </button>
          <button type="button" className="qt-button qt-button-primary" disabled={!ready} onClick={() => void run(false)}>
            {running === 'real' ? 'Queuing…' : 'Run for real'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
