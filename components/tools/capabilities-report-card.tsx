'use client'

/**
 * The Almanack card.
 *
 * Generates, lists, views and deletes system reports. Generation is a blocking
 * POST that returns the whole rendered report in its body, so live phase
 * progress arrives on a separate SSE channel keyed by a client-generated
 * `progressId` — the same side-channel pattern the Green Room uses for chat
 * creation.
 *
 * A run outlives the card (#325). This card lives inside a `CollapsibleCard`,
 * which unmounts its body when closed, so the run — its `progressId`, the
 * progress reader, the phase it has reached and the finished report — is kept
 * in a module-level store rather than in component state. A card that mounts
 * mid-run subscribes to it and draws the same bar with Generate disabled; a
 * report that finished while no card was open is shown by the next one to
 * mount. (The progress channel is also buffered server-side, so the reader
 * never misses the first phase.)
 */

import { useState, useSyncExternalStore } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { apiFetch, apiErrorMessage } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { showConfirmation } from '@/lib/alert'
import { getErrorMessage } from '@/lib/error-utils'
import { formatBytes } from '@/lib/utils/format-bytes'
import { formatDateTime } from '@/lib/format-time'
import { CapabilitiesReportDialog } from './capabilities-report-dialog'
import { Icon } from '@/components/ui/icon'
import { ProgressBar, type ProgressSegment } from '@/components/ui/ProgressBar'
import { ALMANACK_PHASES, ALMANACK_TITLE } from '@/lib/tools/almanack/phases'

interface ReportInfo {
  id: string
  filename: string
  storageKey: string
  createdAt: string
  size: number
}

interface GenerateResponse {
  success: boolean
  reportId: string
  filename: string
  storageKey: string
  size: number
  content: string
}

interface ShownReport {
  id: string
  filename: string
  content: string
}

/**
 * A typical run takes on the order of half a minute with warm caches. The
 * per-phase estimates come from the manifest's `estimatedShare`, so re-weighting
 * a phase there re-weights the bar without touching this file.
 */
const TYPICAL_RUN_MS = 30_000

const SEGMENTS: ProgressSegment[] = ALMANACK_PHASES.map(phase => ({
  key: phase.key,
  // Trim the trailing ellipsis: it reads well in a status line, badly in a
  // row of six-word segment labels.
  label: phase.label.replace(/…$/, ''),
  estimatedDurationMs: Math.round(phase.estimatedShare * TYPICAL_RUN_MS),
}))

// ============================================================================
// The run store — one Almanack run per page, independent of any card instance
// ============================================================================

interface AlmanackRunState {
  running: boolean
  startedAt: number | null
  currentPhase: string | null
  phaseLabel: string | null
  /** The last run's failure, shown until the next run starts */
  error: string | null
  /** A finished report no card has shown yet */
  finished: ShownReport | null
}

const IDLE_RUN: AlmanackRunState = {
  running: false,
  startedAt: null,
  currentPhase: null,
  phaseLabel: null,
  error: null,
  finished: null,
}

let runState: AlmanackRunState = IDLE_RUN
const runListeners = new Set<() => void>()

function updateRun(patch: Partial<AlmanackRunState>) {
  runState = { ...runState, ...patch }
  for (const listener of runListeners) listener()
}

function subscribeRun(listener: () => void) {
  runListeners.add(listener)
  return () => {
    runListeners.delete(listener)
  }
}

const getRunSnapshot = () => runState
const getServerRunSnapshot = () => IDLE_RUN

/** Read the progress stream until it closes or the run settles. */
async function readProgress(progressId: string, signal: AbortSignal) {
  try {
    const res = await fetch(
      `/api/v1/system/tools?action=capabilities-report-progress&id=${encodeURIComponent(progressId)}`,
      { signal, headers: { Accept: 'text/event-stream' } },
    )
    if (!res.ok || !res.body) return

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const raw = line.slice(6).trim()
        if (!raw) continue
        try {
          const event = JSON.parse(raw) as {
            kind: string
            key?: string
            label?: string
            message?: string
          }
          if (!runState.running) continue
          if (event.kind === 'phase' && event.key) {
            updateRun({ currentPhase: event.key, phaseLabel: event.label ?? null })
          } else if (event.kind === 'done' || event.kind === 'error') {
            updateRun({ currentPhase: null, phaseLabel: null })
          }
        } catch {
          // Ignore chunking artifacts / malformed frames.
        }
      }
    }
  } catch {
    // Aborted (the run settled) or a transient network error. The POST's own
    // resolution is what drives the UI, so there is nothing to recover here.
  }
}

/** Start a run unless one is already under way. Resolves when it settles. */
async function startAlmanackRun(queryClient: QueryClient): Promise<void> {
  if (runState.running) return

  const progressId = crypto.randomUUID()
  const controller = new AbortController()
  updateRun({ ...IDLE_RUN, running: true, startedAt: Date.now() })

  // Open the reader BEFORE the POST so the first phase event can't be
  // missed. The bus buffers anyway, but this keeps the bar honest from the
  // very first tick.
  void readProgress(progressId, controller.signal)

  try {
    const result = await apiFetch<GenerateResponse>(
      '/api/v1/system/tools?action=capabilities-report-generate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ progressId }),
      },
    )
    showSuccessToast('The Almanack has been bound')
    updateRun({
      finished: { id: result.reportId, filename: result.filename, content: result.content },
    })
  } catch (err) {
    const message = apiErrorMessage(err, 'The Almanack could not be compiled')
    updateRun({ error: message })
    showErrorToast(message)
  } finally {
    controller.abort()
    updateRun({ running: false, startedAt: null, currentPhase: null, phaseLabel: null })
    void queryClient.invalidateQueries({ queryKey: queryKeys.system.capabilitiesReports })
  }
}

// ============================================================================
// The card
// ============================================================================

export function CapabilitiesReportCard() {
  const queryClient = useQueryClient()
  const run = useSyncExternalStore(subscribeRun, getRunSnapshot, getServerRunSnapshot)

  const [loadingReportId, setLoadingReportId] = useState<string | null>(null)
  // A report the operator opened from the list. A freshly finished run's
  // report (`run.finished`) is shown when no list report is open.
  const [viewedReport, setViewedReport] = useState<ShownReport | null>(null)
  const shownReport = viewedReport ?? run.finished

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.system.capabilitiesReports,
    queryFn: ({ signal }) =>
      apiFetch<{ reports: ReportInfo[] }>(
        '/api/v1/system/tools?action=capabilities-report-list',
        { signal },
      ),
  })
  const reports = data?.reports ?? []

  const deleteMutation = useMutation({
    mutationFn: (reportId: string) =>
      apiFetch<{ success: boolean }>('/api/v1/system/tools?action=capabilities-report-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId }),
      }),
    onSuccess: () => {
      showSuccessToast('Report deleted')
    },
    onError: err => {
      showErrorToast(getErrorMessage(err))
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.system.capabilitiesReports })
    },
  })

  const handleViewReport = async (report: ReportInfo) => {
    try {
      setLoadingReportId(report.id)
      const result = await apiFetch<{ content: string }>(
        `/api/v1/system/tools?action=capabilities-report-get&reportId=${report.id}`,
      )
      setViewedReport({
        id: report.id,
        filename: report.filename,
        content: result.content,
      })
    } catch (err) {
      showErrorToast(getErrorMessage(err))
    } finally {
      setLoadingReportId(null)
    }
  }

  const handleDeleteReport = async (report: ReportInfo) => {
    const confirmed = await showConfirmation(
      `Are you sure you want to delete "${report.filename}"?`,
    )
    if (!confirmed) return
    deleteMutation.mutate(report.id)
  }

  const generating = run.running
  const error = run.error

  return (
    <div className="qt-card p-6">
      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="flex-1">
          <h2 className="qt-heading-2 qt-text mb-1">{ALMANACK_TITLE}</h2>
          <p className="qt-text-small">
            A compendium of the establishment — every cog, ledger and shelf, catalogued
          </p>
        </div>
        <div className="flex-shrink-0 qt-text-brand">
          <Icon name="file" className="w-8 h-8" />
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="qt-bg-destructive/10 border qt-border-destructive qt-text-destructive px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {/* Generate */}
      <div className="mb-6">
        <button
          onClick={() => void startAlmanackRun(queryClient)}
          disabled={generating}
          className="qt-button qt-button-primary w-full flex items-center justify-center gap-2"
        >
          <Icon name="file" className="w-5 h-5" />
          {generating ? 'Compiling the Almanack…' : 'Compile the Almanack'}
        </button>

        {generating && (
          <div className="mt-3">
            <ProgressBar
              segments={SEGMENTS}
              currentKey={run.currentPhase}
              startedAt={run.startedAt}
              // Before the first phase event lands there is no honest width to
              // draw, so the bar slides rather than claiming a percentage.
              indeterminate={run.currentPhase === null}
            />
            {run.phaseLabel && <p className="qt-text-small mt-2">{run.phaseLabel}</p>}
          </div>
        )}
      </div>

      {/* Previous reports */}
      <div>
        <h3 className="qt-heading-4 qt-text mb-3">Previous Editions</h3>

        {isLoading && !generating ? (
          <div className="text-center py-6 qt-text-secondary">
            <div className="qt-spinner h-6 w-6 mx-auto mb-2 animate-spin rounded-full" />
            Loading reports...
          </div>
        ) : reports.length === 0 ? (
          <div className="qt-card p-6 text-center">
            <Icon name="file" className="w-12 h-12 mx-auto mb-3 qt-text-secondary/50" />
            <p className="qt-text-small">No editions yet. Compile one to get started.</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[180px] overflow-y-auto">
            {reports.map(report => (
              <div
                key={report.id}
                className="qt-card p-4 flex items-center justify-between hover:qt-bg-muted/50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="qt-text-primary truncate">{report.filename}</p>
                  <div className="flex gap-4 mt-1 qt-text-small">
                    <span>{formatDateTime(report.createdAt)}</span>
                    <span>{formatBytes(report.size)}</span>
                  </div>
                </div>
                <div className="ml-4 flex items-center gap-2">
                  <button
                    onClick={() => handleViewReport(report)}
                    disabled={loadingReportId === report.id}
                    className="qt-button qt-button-icon qt-button-secondary p-2"
                    title="View Report"
                    aria-label="View Report"
                  >
                    <Icon name="eye" className="w-4 h-4" />
                  </button>

                  <a
                    href={`/api/v1/system/tools?action=capabilities-report-get&reportId=${report.id}&download=true`}
                    download={report.filename}
                    className="qt-button qt-button-icon qt-button-primary p-2"
                    title="Download Report"
                    aria-label="Download Report"
                  >
                    <Icon name="download" className="w-4 h-4" />
                  </a>

                  <button
                    onClick={() => handleDeleteReport(report)}
                    className="qt-button qt-button-icon qt-button-destructive p-2"
                    title="Delete Report"
                    aria-label="Delete Report"
                  >
                    <Icon name="trash" className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Report viewer */}
      {shownReport && (
        <CapabilitiesReportDialog
          isOpen
          onClose={() => {
            if (viewedReport) {
              setViewedReport(null)
            } else {
              updateRun({ finished: null })
            }
          }}
          reportId={shownReport.id}
          filename={shownReport.filename}
          content={shownReport.content}
        />
      )}
    </div>
  )
}
