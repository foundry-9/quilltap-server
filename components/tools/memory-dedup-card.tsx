'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { getErrorMessage } from '@/lib/error-utils'
import type { MaintenanceReport } from '@/lib/memory/maintenance/types'

/**
 * Near-duplicate folding: the maintenance job's first phase, run on its own.
 * The preview is a user-wide dry run of `fold-near-duplicates` (LLM-free, so
 * it may span every character); "Fold" enqueues one maintenance job per
 * character with that phase alone.
 */
const MAINTAIN_URL = '/api/v1/memories?action=maintain'

interface CharacterRow {
  characterId: string
  characterName: string
  eligible: number
  groups: number
  folding: number
}

function rowsFrom(reports: MaintenanceReport[]): CharacterRow[] {
  return reports
    .filter((r) => !r.skippedReason)
    .map((r) => ({
      characterId: r.characterId,
      characterName: r.characterName ?? 'Unnamed',
      eligible: r.fold?.eligible ?? 0,
      groups: r.fold?.groups.length ?? 0,
      folding: r.fold?.folded ?? 0,
    }))
    .sort((a, b) => b.folding - a.folding)
}

type Step = 'idle' | 'analyzing' | 'preview' | 'running' | 'complete'

export function MemoryDedupCard() {
  const [showDialog, setShowDialog] = useState(false)
  const [step, setStep] = useState<Step>('idle')
  const [preview, setPreview] = useState<CharacterRow[] | null>(null)
  const [jobsQueued, setJobsQueued] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const handleAnalyze = async () => {
    setShowDialog(true)
    setStep('analyzing')
    setPreview(null)
    setError(null)

    try {
      const response = await fetch(MAINTAIN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phases: ['fold-near-duplicates'], dryRun: true }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to analyze memories')
      }
      setPreview(rowsFrom(data.reports ?? []))
      setStep('preview')
    } catch (err) {
      const errorMessage = getErrorMessage(err, 'Failed to analyze memories')
      setError(errorMessage)
      setStep('preview')
      console.error('Near-duplicate preview failed', { error: errorMessage })
    }
  }

  const handleRun = async () => {
    if (!preview) return
    setStep('running')
    setError(null)

    try {
      const response = await fetch(MAINTAIN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phases: ['fold-near-duplicates'] }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to fold near-duplicates')
      }
      const queued = Array.isArray(data.jobIds) ? data.jobIds.length : 0
      setJobsQueued(queued)
      setStep('complete')
      showSuccessToast(`Folding dispatched — ${queued} character${queued === 1 ? '' : 's'} queued`)
    } catch (err) {
      const errorMessage = getErrorMessage(err, 'Failed to fold near-duplicates')
      setError(errorMessage)
      setStep('preview')
      console.error('Near-duplicate fold failed', { error: errorMessage })
      showErrorToast(errorMessage)
    }
  }

  const handleClose = () => {
    setShowDialog(false)
    setStep('idle')
    setPreview(null)
    setError(null)
  }

  const totalFolding = preview?.reduce((sum, r) => sum + r.folding, 0) ?? 0
  const totalGroups = preview?.reduce((sum, r) => sum + r.groups, 0) ?? 0
  const totalEligible = preview?.reduce((sum, r) => sum + r.eligible, 0) ?? 0

  return (
    <>
      {/* Card */}
      <div className="qt-card p-6">
        <div className="flex items-start gap-4 mb-6">
          <div className="flex-1">
            <h2 className="qt-heading-2 mb-1">
              Near-Duplicate Folding
            </h2>
            <p className="qt-text-small">
              Finds extracted memories that say the same thing about the same subject on the
              same occasion (as alike as the house demands of a repetition at the door) and
              folds each set into its sturdiest member, keeping any stray detail as a footnote.
              Hand-written entries, digests and archived entries are left strictly alone.
            </p>
          </div>
          <div className="flex-shrink-0 text-primary">
            <Icon name="cpu" className="w-8 h-8" />
          </div>
        </div>

        <button onClick={handleAnalyze} className="qt-button qt-button-primary">
          Analyze Memories
        </button>
      </div>

      {/* Dialog */}
      {showDialog && (
        <>
          {/* Overlay */}
          <button
            className="qt-dialog-overlay z-40 cursor-default border-none p-0"
            onClick={handleClose}
            aria-label="Close dialog"
            type="button"
          />

          {/* Dialog */}
          <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-auto">
            <div className="qt-bg-card rounded-lg qt-shadow-lg w-full max-w-lg">
              {/* Header */}
              <div className="px-6 py-4 border-b qt-border-default">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 qt-bg-primary/10 rounded-full flex items-center justify-center">
                      <Icon name="cpu" className="w-5 h-5 text-primary" />
                    </div>
                    <h2 className="qt-heading-4">
                      {step === 'complete' ? 'Folding Dispatched' : 'Near-Duplicate Folding'}
                    </h2>
                  </div>
                  <button
                    onClick={handleClose}
                    className="qt-button qt-button-ghost qt-text-secondary hover:text-foreground p-1"
                    aria-label="Close dialog"
                  >
                    <Icon name="close" className="w-6 h-6" />
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="px-6 py-6">
                {/* Analyzing step */}
                {step === 'analyzing' && (
                  <div className="flex flex-col items-center justify-center py-8 space-y-4">
                    <svg className="w-12 h-12 animate-spin text-primary" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <p className="qt-text-small">Comparing notes for repetitions...</p>
                  </div>
                )}

                {/* Preview step */}
                {step === 'preview' && (
                  <>
                    {error ? (
                      <div className="p-3 qt-bg-destructive/10 border qt-border-destructive/30 rounded-lg">
                        <p className="text-sm qt-text-destructive">{error}</p>
                      </div>
                    ) : preview ? (
                      <div className="space-y-4">
                        <div className="max-h-64 overflow-y-auto border qt-border-default rounded-lg">
                          <table className="w-full text-sm">
                            <thead className="qt-bg-muted sticky top-0">
                              <tr>
                                <th className="text-left px-3 py-2 qt-text-secondary font-medium">Character</th>
                                <th className="text-right px-3 py-2 qt-text-secondary font-medium" title="Hot extracted memories with an embedding — the only ones folding considers">Eligible</th>
                                <th className="text-right px-3 py-2 qt-text-secondary font-medium">Sets</th>
                                <th className="text-right px-3 py-2 qt-text-secondary font-medium">To fold</th>
                              </tr>
                            </thead>
                            <tbody>
                              {preview.map((row) => (
                                <tr key={row.characterId} className={row.groups === 0 ? 'opacity-50' : ''}>
                                  <td className="px-3 py-2 text-foreground truncate max-w-[150px]">{row.characterName}</td>
                                  <td className="text-right px-3 py-2 qt-text-primary">{row.eligible}</td>
                                  <td className="text-right px-3 py-2 qt-text-primary">{row.groups}</td>
                                  <td className="text-right px-3 py-2 qt-text-primary">{row.folding}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot className="qt-bg-muted border-t qt-border-default">
                              <tr className="font-semibold">
                                <td className="px-3 py-2 text-foreground">Total</td>
                                <td className="text-right px-3 py-2 text-foreground">{totalEligible}</td>
                                <td className="text-right px-3 py-2 text-foreground">{totalGroups}</td>
                                <td className="text-right px-3 py-2 text-foreground">{totalFolding}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>

                        {totalFolding > 0 ? (
                          <div className="qt-bg-primary/10 border qt-border-primary/30 rounded-lg p-3">
                            <p className="text-sm text-foreground">
                              <span className="font-semibold">{totalFolding}</span> repetitions would be folded
                              into <span className="font-semibold">{totalGroups}</span> surviving memories.
                            </p>
                          </div>
                        ) : (
                          <div className="qt-bg-muted rounded-lg p-3">
                            <p className="text-sm qt-text-secondary">
                              Not a single repetition to be found. The books are in admirable order.
                            </p>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </>
                )}

                {/* Running step */}
                {step === 'running' && (
                  <div className="flex flex-col items-center justify-center py-8 space-y-4">
                    <svg className="w-12 h-12 animate-spin text-primary" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <p className="qt-text-small">Dispatching the folding...</p>
                  </div>
                )}

                {/* Complete step */}
                {step === 'complete' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-center">
                      <div className="w-16 h-16 qt-bg-success/10 rounded-full flex items-center justify-center">
                        <Icon name="check" className="w-8 h-8 qt-text-success" />
                      </div>
                    </div>
                    <p className="text-center qt-text-small">
                      {jobsQueued} maintenance {jobsQueued === 1 ? 'job has' : 'jobs have'} been sent below
                      stairs. Each character&apos;s repetitions are folded in the background; the
                      Commonplace Book will reflect the tidying as each finishes.
                    </p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 qt-bg-muted border-t qt-border-default flex gap-3 justify-end">
                {step === 'preview' && (
                  <>
                    <button onClick={handleClose} className="qt-button qt-button-secondary">
                      Cancel
                    </button>
                    <button
                      onClick={handleRun}
                      disabled={!preview || totalFolding === 0}
                      className="qt-button qt-button-primary"
                    >
                      Fold Repetitions
                    </button>
                  </>
                )}

                {step === 'complete' && (
                  <button onClick={handleClose} className="qt-button qt-button-primary">
                    Done
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
