'use client'

import { useState } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { showSuccessToast, showErrorToast } from '@/lib/toast'

interface DeleteSummary {
  characters: number
  personas: number
  chats: number
  tags: number
  files: number
  memories: number
  apiKeys: number
  backups: number
  profiles: {
    connection: number
    image: number
    embedding: number
  }
}

export function DeleteDataCard() {
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [step, setStep] = useState<'preview' | 'confirm' | 'deleting' | 'complete'>('preview')
  const [preview, setPreview] = useState<DeleteSummary | null>(null)
  const [deleteSummary, setDeleteSummary] = useState<DeleteSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleOpenDialog = async () => {
    setShowConfirmDialog(true)
    setStep('preview')
    setPreview(null)
    setDeleteSummary(null)
    setConfirmText('')
    setError(null)
    setLoading(true)

    try {
      clientLogger.info('Loading delete preview')
      const response = await fetch('/api/tools/delete-data')
      if (!response.ok) {
        throw new Error('Failed to load data preview')
      }
      const data = await response.json()
      setPreview(data.summary)
      clientLogger.info('Delete preview loaded', { summary: data.summary })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load preview'
      setError(errorMessage)
      clientLogger.error('Failed to load delete preview', { error: errorMessage })
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setShowConfirmDialog(false)
    setStep('preview')
    setPreview(null)
    setDeleteSummary(null)
    setConfirmText('')
    setError(null)
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
      clientLogger.info('Starting complete data deletion')
      const response = await fetch('/api/tools/delete-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE_ALL_MY_DATA' }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete data')
      }

      const data = await response.json()
      setDeleteSummary(data.summary)
      setStep('complete')
      clientLogger.info('Complete data deletion finished', { summary: data.summary })
      showSuccessToast('All data has been deleted')
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete data'
      setError(errorMessage)
      setStep('confirm')
      clientLogger.error('Data deletion failed', { error: errorMessage })
      showErrorToast(errorMessage)
    }
  }

  const getTotalCount = (summary: DeleteSummary): number => {
    return (
      summary.characters +
      summary.personas +
      summary.chats +
      summary.tags +
      summary.files +
      summary.memories +
      summary.apiKeys +
      summary.backups +
      summary.profiles.connection +
      summary.profiles.image +
      summary.profiles.embedding
    )
  }

  return (
    <>
      {/* Card */}
      <div className="bg-card rounded-lg shadow-md border border-border p-6">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-12 h-12 bg-destructive/10 rounded-lg flex items-center justify-center">
            <svg className="w-6 h-6 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-foreground">Delete All Data</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Permanently delete all your data including characters, personas, chats, files, API keys, and backups. This action cannot be undone.
            </p>
            <button
              onClick={handleOpenDialog}
              className="mt-4 px-4 py-2 bg-destructive text-white rounded-lg text-sm font-medium hover:bg-destructive/90 transition-colors"
            >
              Delete All Data
            </button>
          </div>
        </div>
      </div>

      {/* Dialog */}
      {showConfirmDialog && (
        <>
          {/* Overlay */}
          <button
            className="fixed inset-0 bg-black/50 z-40 cursor-default border-none p-0"
            onClick={handleClose}
            aria-label="Close dialog"
            type="button"
          />

          {/* Dialog */}
          <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-auto">
            <div className="bg-card rounded-lg shadow-xl w-full max-w-md">
              {/* Header */}
              <div className="px-6 py-4 border-b border-border">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-destructive/10 rounded-full flex items-center justify-center">
                      <svg className="w-5 h-5 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </div>
                    <h2 className="text-lg font-semibold text-foreground">
                      {step === 'complete' ? 'Deletion Complete' : 'Delete All Data'}
                    </h2>
                  </div>
                  <button
                    onClick={handleClose}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Close dialog"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="px-6 py-6">
                {step === 'preview' && (
                  <>
                    {loading ? (
                      <div className="flex items-center justify-center py-8">
                        <svg className="w-8 h-8 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                      </div>
                    ) : preview ? (
                      <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                          The following data will be permanently deleted:
                        </p>
                        <div className="bg-muted rounded-lg p-4 space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Characters</span>
                            <span className="font-medium text-foreground">{preview.characters}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Personas</span>
                            <span className="font-medium text-foreground">{preview.personas}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Chats</span>
                            <span className="font-medium text-foreground">{preview.chats}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Tags</span>
                            <span className="font-medium text-foreground">{preview.tags}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Files</span>
                            <span className="font-medium text-foreground">{preview.files}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Memories</span>
                            <span className="font-medium text-foreground">{preview.memories}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">API Keys</span>
                            <span className="font-medium text-foreground">{preview.apiKeys}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Backups</span>
                            <span className="font-medium text-foreground">{preview.backups}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Connection Profiles</span>
                            <span className="font-medium text-foreground">{preview.profiles.connection}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Image Profiles</span>
                            <span className="font-medium text-foreground">{preview.profiles.image}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Embedding Profiles</span>
                            <span className="font-medium text-foreground">{preview.profiles.embedding}</span>
                          </div>
                          <div className="border-t border-border pt-2 mt-2">
                            <div className="flex justify-between font-semibold">
                              <span className="text-foreground">Total Items</span>
                              <span className="text-destructive">{getTotalCount(preview)}</span>
                            </div>
                          </div>
                        </div>
                        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3">
                          <p className="text-sm text-destructive font-medium">
                            This action cannot be undone. All your data will be permanently deleted.
                          </p>
                        </div>
                      </div>
                    ) : error ? (
                      <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
                        <p className="text-sm text-destructive">{error}</p>
                      </div>
                    ) : null}
                  </>
                )}

                {step === 'confirm' && (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      To confirm deletion, please type <span className="font-mono font-semibold text-destructive">DELETE</span> below:
                    </p>
                    <input
                      type="text"
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                      placeholder="Type DELETE to confirm"
                      className="w-full px-3 py-2 border border-input rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      autoFocus
                    />
                    {error && (
                      <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
                        <p className="text-sm text-destructive">{error}</p>
                      </div>
                    )}
                  </div>
                )}

                {step === 'deleting' && (
                  <div className="flex flex-col items-center justify-center py-8 space-y-4">
                    <svg className="w-12 h-12 animate-spin text-destructive" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <p className="text-sm text-muted-foreground">Deleting all data...</p>
                  </div>
                )}

                {step === 'complete' && deleteSummary && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-center">
                      <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center">
                        <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    </div>
                    <p className="text-center text-sm text-muted-foreground">
                      Successfully deleted {getTotalCount(deleteSummary)} items from your account.
                    </p>
                    <p className="text-center text-xs text-muted-foreground">
                      Your account is now clean. You can start fresh or restore from a backup.
                    </p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 bg-muted border-t border-border flex gap-3 justify-end">
                {step === 'preview' && (
                  <>
                    <button
                      onClick={handleClose}
                      className="px-4 py-2 border border-input rounded-lg text-sm font-medium text-foreground bg-background hover:bg-accent transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleProceedToConfirm}
                      disabled={loading || !preview || getTotalCount(preview) === 0}
                      className="px-4 py-2 bg-destructive text-white rounded-lg text-sm font-medium hover:bg-destructive/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Continue
                    </button>
                  </>
                )}

                {step === 'confirm' && (
                  <>
                    <button
                      onClick={() => setStep('preview')}
                      className="px-4 py-2 border border-input rounded-lg text-sm font-medium text-foreground bg-background hover:bg-accent transition-colors"
                    >
                      Back
                    </button>
                    <button
                      onClick={handleDelete}
                      disabled={confirmText !== 'DELETE'}
                      className="px-4 py-2 bg-destructive text-white rounded-lg text-sm font-medium hover:bg-destructive/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Delete Everything
                    </button>
                  </>
                )}

                {step === 'complete' && (
                  <button
                    onClick={handleClose}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
                  >
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
