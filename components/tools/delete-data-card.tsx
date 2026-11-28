'use client'

import { useState } from 'react'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { getErrorMessage } from '@/lib/error-utils'
import { Icon } from '@/components/ui/icon'
import { WizardModal } from '@/components/ui/WizardModal'
import type { DeleteSummary } from '@/lib/backup/restore-service'
import { Spinner } from '@/components/ui/Spinner'

/** The counted rows of a delete summary, in display order (templates follow separately). */
const SUMMARY_ROWS: ReadonlyArray<{ label: string; count: (summary: DeleteSummary) => number }> = [
  { label: 'Characters', count: (s) => s.characters },
  { label: 'Chats', count: (s) => s.chats },
  { label: 'Projects', count: (s) => s.projects },
  { label: 'Tags', count: (s) => s.tags },
  { label: 'Files', count: (s) => s.files },
  { label: 'Memories', count: (s) => s.memories },
  { label: 'API Keys', count: (s) => s.apiKeys },
  { label: 'Backups', count: (s) => s.backups },
  { label: 'Connection Profiles', count: (s) => s.profiles.connection },
  { label: 'Image Profiles', count: (s) => s.profiles.image },
  { label: 'Embedding Profiles', count: (s) => s.profiles.embedding },
]

const TEMPLATE_ROWS: ReadonlyArray<{ label: string; count: (summary: DeleteSummary) => number }> = [
  { label: 'Prompt Templates', count: (s) => s.templates.prompt },
  { label: 'Roleplay Templates', count: (s) => s.templates.roleplay },
]

/** Everything the deletion removes (archive bundles are reported apart). */
function getTotalCount(summary: DeleteSummary): number {
  return [...SUMMARY_ROWS, ...TEMPLATE_ROWS].reduce((sum, row) => sum + row.count(summary), 0)
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <span className="qt-text-secondary">{label}</span>
      <span className="qt-text-primary">{value}</span>
    </div>
  )
}

export function DeleteDataCard() {
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [step, setStep] = useState<'preview' | 'confirm' | 'deleting' | 'complete'>('preview')
  const [preview, setPreview] = useState<DeleteSummary | null>(null)
  const [deleteSummary, setDeleteSummary] = useState<DeleteSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [keepArchives, setKeepArchives] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const handleClose = () => {
    if (step === 'deleting') return
    if (step === 'complete') {
      // Every list, picker, sidebar and open tab still holds the deleted rows
      // in its client cache; reload so the whole app reads the empty instance,
      // as a finished restore does (#349). Every way out of the dialog lands here.
      window.location.reload()
      return
    }
    setShowConfirmDialog(false)
    setStep('preview')
    setPreview(null)
    setDeleteSummary(null)
    setConfirmText('')
    setKeepArchives(true)
    setError(null)
  }

  const handleOpenDialog = async () => {
    setShowConfirmDialog(true)
    setStep('preview')
    setPreview(null)
    setDeleteSummary(null)
    setConfirmText('')
    setKeepArchives(true)
    setError(null)
    setLoading(true)

    try {
      const response = await fetch('/api/v1/system/tools?action=delete-data-preview')
      if (!response.ok) {
        throw new Error('Failed to load data preview')
      }
      const data = await response.json()
      setPreview(data.summary)
    } catch (err) {
      const errorMessage = getErrorMessage(err, 'Failed to load preview')
      setError(errorMessage)
      console.error('Failed to load delete preview', { error: errorMessage })
    } finally {
      setLoading(false)
    }
  }

  const handleProceedToConfirm = () => {
    setStep('confirm')
    setConfirmText('')
  }

  const handleDelete = async () => {
    if (confirmText !== 'DELETE') {
      setError('Please type DELETE to confirm')
      return
    }

    setStep('deleting')
    setError(null)

    try {
      const response = await fetch('/api/v1/system/tools?action=delete-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirm: 'DELETE_ALL_MY_DATA',
          keepArchivedCharacterBundles: keepArchives,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete data')
      }

      const data = await response.json()
      setDeleteSummary(data.summary)
      setStep('complete')
      showSuccessToast('All data has been deleted')
    } catch (err) {
      const errorMessage = getErrorMessage(err, 'Failed to delete data')
      setError(errorMessage)
      setStep('confirm')
      console.error('Data deletion failed', { error: errorMessage })
      showErrorToast(errorMessage)
    }
  }

  return (
    <>
      {/* Card */}
      <div className="qt-card p-6">
        {/* Header */}
        <div className="flex items-start gap-4 mb-6">
          <div className="flex-1">
            <h2 className="qt-heading-2 qt-text mb-1">
              Delete All Data
            </h2>
            <p className="qt-text-small">
              Permanently delete all your data including characters, personas, chats, files, API keys, and backups. This action cannot be undone.
            </p>
          </div>
          <div className="flex-shrink-0 qt-text-destructive">
            <Icon name="trash" className="w-8 h-8" />
          </div>
        </div>

        {/* Action Button */}
        <button
          onClick={handleOpenDialog}
          className="qt-button qt-button-destructive"
        >
          Delete All Data
        </button>
      </div>

      {/* Dialog */}
      {showConfirmDialog && (
        <WizardModal
          onClose={handleClose}
          role="alertdialog"
          title={
            <span className="flex items-center gap-3">
              <span className="w-10 h-10 qt-bg-destructive/10 rounded-full flex items-center justify-center">
                <Icon name="alert-triangle" className="w-5 h-5 qt-text-destructive" />
              </span>
              <span className="qt-text">
                {step === 'complete' ? 'Deletion Complete' : 'Delete All Data'}
              </span>
            </span>
          }
          busy={step === 'deleting'}
          maxWidth="md"
          footer={
            <>
              {step === 'preview' && (
                <>
                  <button
                    onClick={handleClose}
                    className="qt-button qt-button-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleProceedToConfirm}
                    disabled={loading || !preview || getTotalCount(preview) === 0}
                    className="qt-button qt-button-destructive"
                  >
                    Continue
                  </button>
                </>
              )}

              {step === 'confirm' && (
                <>
                  <button
                    onClick={() => setStep('preview')}
                    className="qt-button qt-button-secondary"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={confirmText !== 'DELETE'}
                    className="qt-button qt-button-destructive"
                  >
                    Delete Everything
                  </button>
                </>
              )}

              {step === 'complete' && (
                <button
                  onClick={handleClose}
                  className="qt-button qt-button-primary"
                >
                  Done
                </button>
              )}
            </>
          }
        >
        {step === 'preview' && (
          <>
            {loading ? (
              <div className="qt-loading-state">
                <Spinner className="w-8 h-8 qt-text-secondary" />
              </div>
            ) : preview ? (
              <div className="space-y-4">
                <p className="qt-text-small">
                  The following data will be permanently deleted:
                </p>
                <div className="qt-bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
                  {SUMMARY_ROWS.map((row) => (
                    <SummaryRow key={row.label} label={row.label} value={row.count(preview)} />
                  ))}
                  {TEMPLATE_ROWS.some((row) => row.count(preview) > 0) &&
                    TEMPLATE_ROWS.map((row) => (
                      <SummaryRow key={row.label} label={row.label} value={row.count(preview)} />
                    ))}
                  {preview.archiveBundles > 0 && (
                    <SummaryRow
                      label="Archived Character Bundles"
                      value={`${preview.archiveBundles} ${keepArchives ? '(kept)' : ''}`}
                    />
                  )}
                  <div className="border-t qt-border-default pt-2 mt-2">
                    <div className="flex justify-between font-semibold">
                      <span className="qt-text">Total Items</span>
                      <span className="qt-text-destructive">{getTotalCount(preview)}</span>
                    </div>
                  </div>
                </div>
                {preview.archiveBundles > 0 && (
                  <div className="qt-bg-muted/50 border qt-border-default rounded-lg p-3 space-y-2">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={keepArchives}
                        onChange={(e) => setKeepArchives(e.target.checked)}
                        className="mt-0.5 w-4 h-4 rounded qt-focus-ring"
                      />
                      <span className="text-sm qt-text-primary">
                        Leave the archived-character bundles on the shelf ({preview.archiveBundles}{' '}
                        {preview.archiveBundles === 1 ? 'file' : 'files'})
                      </span>
                    </label>
                    <p className="qt-text-xs qt-text-secondary">
                      Their character records perish with everything else, so what remains is a
                      loose bundle apiece — each may be imported afresh, but none can simply be
                      woken. Untick to sweep the shelf bare as well.
                    </p>
                  </div>
                )}
                <div className="qt-bg-destructive/10 border qt-border-destructive/30 rounded-lg p-3">
                  <p className="text-sm qt-text-destructive font-medium">
                    This action cannot be undone. All your data will be permanently deleted.
                  </p>
                </div>
              </div>
            ) : error ? (
              <div className="p-3 qt-bg-destructive/10 border qt-border-destructive/30 rounded-lg">
                <p className="text-sm qt-text-destructive">{error}</p>
              </div>
            ) : null}
          </>
        )}

        {step === 'confirm' && (
          <div className="space-y-4">
            <p className="qt-text-small">
              To confirm deletion, please type <span className="font-mono font-semibold qt-text-destructive">DELETE</span> below:
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
              placeholder="Type DELETE to confirm"
              aria-label="Type DELETE to confirm"
              className="qt-input"
              autoFocus
            />
            {error && (
              <div className="p-3 qt-bg-destructive/10 border qt-border-destructive/30 rounded-lg">
                <p className="text-sm qt-text-destructive">{error}</p>
              </div>
            )}
          </div>
        )}

        {step === 'deleting' && (
          <div className="flex flex-col items-center justify-center py-8 space-y-4">
            <Spinner className="w-12 h-12 qt-text-destructive" />
            <p className="qt-text-small">Deleting all data...</p>
          </div>
        )}

        {step === 'complete' && deleteSummary && (
          <div className="space-y-4">
            <div className="flex items-center justify-center">
              <div className="w-16 h-16 qt-bg-success/10 rounded-full flex items-center justify-center">
                <Icon name="check" className="w-8 h-8 qt-text-success" />
              </div>
            </div>
            <p className="text-center qt-text-small">
              Successfully deleted {getTotalCount(deleteSummary)} items from your account.
            </p>
            {deleteSummary.archiveBundlesKept && deleteSummary.archiveBundles > 0 && (
              <p className="text-center qt-text-xs">
                {deleteSummary.archiveBundles} archived-character{' '}
                {deleteSummary.archiveBundles === 1 ? 'bundle remains' : 'bundles remain'} on the
                shelf, ready for import.
              </p>
            )}
            <p className="text-center qt-text-xs">
              Your account is now clean. You can start fresh or restore from a backup.
            </p>
          </div>
        )}
        </WizardModal>
      )}
    </>
  )
}
