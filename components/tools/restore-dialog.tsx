'use client'

import { useState, useEffect, useRef } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import type { BackupInfo, RestoreSummary } from '@/lib/backup/types'

interface RestoreDialogProps {
  isOpen: boolean
  onClose: () => void
  onRestoreComplete: () => void
  initialS3Key?: string
}

type RestoreStep = 'source' | 'preview' | 'mode' | 'progress'
type RestoreMode = 'replace' | 'import'

interface RestorePreview {
  characters: number
  personas: number
  chats: number
  messages: number
  tags: number
  files: number
  memories: number
}

export function RestoreDialog({ isOpen, onClose, onRestoreComplete, initialS3Key }: RestoreDialogProps) {
  const [step, setStep] = useState<RestoreStep>('source')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [s3Backups, setS3Backups] = useState<BackupInfo[]>([])
  const [selectedS3Key, setSelectedS3Key] = useState<string | null>(initialS3Key || null)
  const [loadingBackups, setLoadingBackups] = useState(false)
  const [backupsLoaded, setBackupsLoaded] = useState(false)
  const [preview, setPreview] = useState<RestorePreview | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [restoreMode, setRestoreMode] = useState<RestoreMode>('import')
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [restoreSummary, setRestoreSummary] = useState<RestoreSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load S3 backups when dialog opens
  useEffect(() => {
    if (isOpen && step === 'source' && !backupsLoaded && !loadingBackups) {
      loadS3Backups()
    }
  }, [isOpen, step, backupsLoaded, loadingBackups])

  // Reset state when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setBackupsLoaded(false)
    }
  }, [isOpen])

  if (!isOpen) return null

  const loadS3Backups = async () => {
    setLoadingBackups(true)
    try {
      clientLogger.info('Loading S3 backups')
      const response = await fetch('/api/tools/backup/list')
      if (!response.ok) throw new Error('Failed to load backups')
      const data = await response.json()
      setS3Backups(data.backups || data || [])
      setBackupsLoaded(true)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load backups'
      clientLogger.error('Failed to load S3 backups', { error: errorMessage })
      setBackupsLoaded(true) // Mark as loaded even on error to prevent infinite retries
    } finally {
      setLoadingBackups(false)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedFile(e.target.files?.[0] || null)
    setSelectedS3Key(null)
    setError(null)
  }

  const handleS3Select = (key: string) => {
    setSelectedS3Key(key)
    setSelectedFile(null)
    setError(null)
  }

  const handleNext = async () => {
    if (step === 'source') {
      if (!selectedFile && !selectedS3Key) {
        setError('Please select a backup source')
        return
      }
      await fetchPreview()
    } else if (step === 'preview') {
      setStep('mode')
    }
  }

  const handleBack = () => {
    if (step === 'preview') {
      setStep('source')
      setPreview(null)
    } else if (step === 'mode') {
      setStep('preview')
    } else if (step === 'progress') {
      setStep('mode')
      setRestoreSummary(null)
    }
  }

  const fetchPreview = async () => {
    setLoadingPreview(true)
    setError(null)

    try {
      clientLogger.info('Fetching restore preview', {
        hasFile: !!selectedFile,
        hasS3Key: !!selectedS3Key,
      })

      let backupData: ArrayBuffer | string

      if (selectedFile) {
        backupData = await selectedFile.arrayBuffer()
      } else if (selectedS3Key) {
        const response = await fetch(`/api/tools/backup/download/${selectedS3Key}`)
        if (!response.ok) throw new Error('Failed to load backup from S3')
        backupData = await response.arrayBuffer()
      } else {
        throw new Error('No backup source selected')
      }

      // Call preview endpoint
      const formData = new FormData()
      if (selectedFile) {
        formData.append('file', selectedFile)
      } else if (selectedS3Key) {
        formData.append('s3Key', selectedS3Key)
      }

      const previewResponse = await fetch('/api/tools/backup/preview', {
        method: 'POST',
        body: formData,
      })

      if (!previewResponse.ok) {
        const data = await previewResponse.json()
        throw new Error(data.error || 'Failed to preview backup')
      }

      const previewData = await previewResponse.json()
      setPreview(previewData.preview)
      setStep('preview')

      clientLogger.info('Preview loaded successfully', { preview: previewData.preview })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to preview backup'
      setError(errorMessage)
      clientLogger.error('Failed to fetch preview', { error: errorMessage })
      showErrorToast(errorMessage)
    } finally {
      setLoadingPreview(false)
    }
  }

  const handleStartRestore = async () => {
    if (restoreMode === 'replace' && !confirmReplace) {
      setError('Please confirm that you want to delete your existing data')
      return
    }

    setRestoring(true)
    setError(null)
    setStep('progress')

    try {
      clientLogger.info('Starting restore', {
        mode: restoreMode,
        hasFile: !!selectedFile,
        hasS3Key: !!selectedS3Key,
      })

      const formData = new FormData()
      if (selectedFile) {
        formData.append('file', selectedFile)
      } else if (selectedS3Key) {
        formData.append('s3Key', selectedS3Key)
      }
      formData.append('mode', restoreMode === 'replace' ? 'replace' : 'new-account')

      const response = await fetch('/api/tools/backup/restore', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to restore backup')
      }

      const data = await response.json()
      setRestoreSummary(data.summary)

      clientLogger.info('Restore completed successfully', {
        summary: data.summary,
      })

      showSuccessToast('Backup restored successfully')
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to restore backup'
      setError(errorMessage)
      clientLogger.error('Restore failed', { error: errorMessage })
      showErrorToast(errorMessage)
      setStep('mode')
    } finally {
      setRestoring(false)
    }
  }

  const handleClose = () => {
    if (!restoring) {
      resetDialog()
      onClose()
    }
  }

  const handleCloseAfterRestore = () => {
    resetDialog()
    onRestoreComplete()
    onClose()
  }

  const resetDialog = () => {
    setStep('source')
    setSelectedFile(null)
    setSelectedS3Key(null)
    setPreview(null)
    setRestoreMode('import')
    setConfirmReplace(false)
    setRestoreSummary(null)
    setError(null)
  }

  // ============================================================================
  // RENDER FUNCTIONS
  // ============================================================================

  const renderSourceSelection = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-foreground mb-3">
          Upload Local Backup
        </label>
        <div className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-input transition-colors"
          onClick={() => fileInputRef.current?.click()}
        >
          <svg className="w-12 h-12 mx-auto text-muted-foreground mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <p className="text-sm text-muted-foreground">
            Click to select or drag and drop a backup file
          </p>
          {selectedFile && (
            <p className="text-sm text-green-600 mt-2">
              Selected: {selectedFile.name}
            </p>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.zip"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      </div>

      {/* S3 Backups */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-3">
          Or Select from Cloud Storage
        </label>
        {loadingBackups ? (
          <div className="text-center py-6 text-muted-foreground">
            Loading backups...
          </div>
        ) : s3Backups.length > 0 ? (
          <div className="space-y-2">
            {s3Backups.map((backup) => (
              <label
                key={backup.key}
                className={`flex items-center p-3 border rounded-lg cursor-pointer transition-colors ${
                  selectedS3Key === backup.key
                    ? 'border-primary bg-accent'
                    : 'border-border bg-background hover:border-input'
                }`}
              >
                <input
                  type="radio"
                  name="s3Backup"
                  checked={selectedS3Key === backup.key}
                  onChange={() => handleS3Select(backup.key)}
                  className="w-4 h-4"
                />
                <div className="ml-3 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {backup.filename}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {new Date(backup.createdAt).toLocaleString()} ({Math.round(backup.size / 1024 / 1024)} MB)
                  </p>
                </div>
              </label>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-muted-foreground">
            No backups found in cloud storage
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive rounded-lg">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}
    </div>
  )

  const renderPreview = () => (
    <div className="space-y-4">
      {preview ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-muted p-4 rounded-lg">
            <p className="text-2xl font-bold text-foreground">{preview.characters}</p>
            <p className="text-xs text-muted-foreground mt-1">Characters</p>
          </div>
          <div className="bg-muted p-4 rounded-lg">
            <p className="text-2xl font-bold text-foreground">{preview.personas}</p>
            <p className="text-xs text-muted-foreground mt-1">Personas</p>
          </div>
          <div className="bg-muted p-4 rounded-lg">
            <p className="text-2xl font-bold text-foreground">{preview.chats}</p>
            <p className="text-xs text-muted-foreground mt-1">Chats</p>
          </div>
          <div className="bg-muted p-4 rounded-lg">
            <p className="text-2xl font-bold text-foreground">{preview.messages}</p>
            <p className="text-xs text-muted-foreground mt-1">Messages</p>
          </div>
          <div className="bg-muted p-4 rounded-lg">
            <p className="text-2xl font-bold text-foreground">{preview.tags}</p>
            <p className="text-xs text-muted-foreground mt-1">Tags</p>
          </div>
          <div className="bg-muted p-4 rounded-lg">
            <p className="text-2xl font-bold text-foreground">{preview.memories}</p>
            <p className="text-xs text-muted-foreground mt-1">Memories</p>
          </div>
        </div>
      ) : (
        <div className="text-center py-8 text-muted-foreground">
          {loadingPreview ? 'Loading preview...' : 'No preview available'}
        </div>
      )}
    </div>
  )

  const renderModeSelection = () => (
    <div className="space-y-4">
      <div className="space-y-3">
        {/* Replace Mode */}
        <label className={`flex items-start p-4 border-2 rounded-lg cursor-pointer transition-colors ${
          restoreMode === 'replace'
            ? 'border-destructive bg-destructive/10'
            : 'border-border bg-background'
        }`}>
          <input
            type="radio"
            name="mode"
            value="replace"
            checked={restoreMode === 'replace'}
            onChange={(e) => {
              setRestoreMode(e.target.value as RestoreMode)
              setConfirmReplace(false)
            }}
            className="mt-1"
          />
          <div className="ml-3 flex-1">
            <p className="text-sm font-medium text-foreground">
              Replace Existing Data
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Delete all your current data and replace with backup
            </p>
          </div>
        </label>

        {/* Import Mode */}
        <label className={`flex items-start p-4 border-2 rounded-lg cursor-pointer transition-colors ${
          restoreMode === 'import'
            ? 'border-primary bg-accent'
            : 'border-border bg-background'
        }`}>
          <input
            type="radio"
            name="mode"
            value="import"
            checked={restoreMode === 'import'}
            onChange={(e) => setRestoreMode(e.target.value as RestoreMode)}
            className="mt-1"
          />
          <div className="ml-3 flex-1">
            <p className="text-sm font-medium text-foreground">
              Import as New Data
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Keep your existing data and import backup with regenerated IDs
            </p>
          </div>
        </label>
      </div>

      {/* Replace Mode Warning */}
      {restoreMode === 'replace' && (
        <div className="bg-destructive/10 border border-destructive rounded-lg p-4">
          <p className="text-sm font-medium text-destructive mb-3">
            Warning: This will DELETE all your current data!
          </p>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={confirmReplace}
              onChange={(e) => setConfirmReplace(e.target.checked)}
              className="w-4 h-4 text-destructive rounded focus:ring-ring"
            />
            <span className="text-sm text-destructive">
              I understand this action cannot be undone
            </span>
          </label>
        </div>
      )}

      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive rounded-lg">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}
    </div>
  )

  const renderProgress = () => (
    <div className="space-y-4">
      {restoring ? (
        <div className="text-center py-8">
          <div className="inline-block">
            <svg className="w-12 h-12 text-primary animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Restoring your backup...
          </p>
        </div>
      ) : restoreSummary ? (
        <div className="space-y-4">
          <div className="bg-green-100/30 border border-green-600 rounded-lg p-4">
            <p className="text-sm font-medium text-green-800">
              Backup restored successfully!
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-muted p-4 rounded-lg">
              <p className="text-2xl font-bold text-foreground">{restoreSummary.characters}</p>
              <p className="text-xs text-muted-foreground mt-1">Characters</p>
            </div>
            <div className="bg-muted p-4 rounded-lg">
              <p className="text-2xl font-bold text-foreground">{restoreSummary.personas}</p>
              <p className="text-xs text-muted-foreground mt-1">Personas</p>
            </div>
            <div className="bg-muted p-4 rounded-lg">
              <p className="text-2xl font-bold text-foreground">{restoreSummary.chats}</p>
              <p className="text-xs text-muted-foreground mt-1">Chats</p>
            </div>
            <div className="bg-muted p-4 rounded-lg">
              <p className="text-2xl font-bold text-foreground">{restoreSummary.messages}</p>
              <p className="text-xs text-muted-foreground mt-1">Messages</p>
            </div>
            <div className="bg-muted p-4 rounded-lg">
              <p className="text-2xl font-bold text-foreground">{restoreSummary.profiles.connection}</p>
              <p className="text-xs text-muted-foreground mt-1">API Keys</p>
            </div>
            <div className="bg-muted p-4 rounded-lg">
              <p className="text-2xl font-bold text-foreground">{restoreSummary.files}</p>
              <p className="text-xs text-muted-foreground mt-1">Files</p>
            </div>
          </div>

          {/* Warnings */}
          {restoreSummary.warnings && restoreSummary.warnings.length > 0 && (
            <div className="bg-yellow-100/30 border border-yellow-600 rounded-lg p-4">
              <p className="text-sm font-medium text-yellow-800 mb-2">
                Warnings ({restoreSummary.warnings.length}):
              </p>
              <ul className="text-sm text-yellow-700 space-y-1 max-h-40 overflow-y-auto">
                {restoreSummary.warnings.map((warning, idx) => (
                  <li key={idx} className="flex gap-2">
                    <span className="flex-shrink-0">•</span>
                    <span className="break-words">{warning}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : error ? (
        <div className="p-4 bg-destructive/10 border border-destructive rounded-lg">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      ) : null}
    </div>
  )

  return (
    <>
      {/* Overlay */}
      <button
        className="qt-dialog-overlay !p-0 cursor-default border-none z-40"
        onClick={handleClose}
        disabled={restoring}
        aria-label="Close dialog"
        type="button"
      />

      {/* Dialog */}
      <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-auto w-[90vw] max-w-2xl">
        <div className="qt-dialog w-full max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="qt-dialog-header flex-shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="qt-dialog-title">Restore Backup</h2>
                <p className="qt-dialog-description mt-0.5">
                  Step {step === 'source' ? 1 : step === 'preview' ? 2 : step === 'mode' ? 3 : 4} of 4
                </p>
              </div>
              <button
                onClick={handleClose}
                disabled={restoring}
                className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                aria-label="Close dialog"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="qt-dialog-body overflow-y-auto flex-1">
            {step === 'source' && renderSourceSelection()}
            {step === 'preview' && renderPreview()}
            {step === 'mode' && renderModeSelection()}
            {step === 'progress' && renderProgress()}
          </div>

          {/* Footer */}
          <div className="qt-dialog-footer flex gap-3 justify-between flex-shrink-0">
            {step === 'progress' && restoreSummary ? (
              <button
                onClick={handleCloseAfterRestore}
                className="flex-1 qt-button qt-button-primary"
              >
                Close
              </button>
            ) : (
              <>
                <button
                  onClick={handleBack}
                  disabled={step === 'source' || restoring}
                  className="qt-button qt-button-secondary"
                >
                  Back
                </button>

                {step === 'progress' ? null : (
                  <>
                    <button
                      onClick={handleClose}
                      disabled={restoring}
                      className="qt-button qt-button-secondary"
                    >
                      Cancel
                    </button>

                    {step === 'mode' ? (
                      <button
                        onClick={handleStartRestore}
                        disabled={restoring || (restoreMode === 'replace' && !confirmReplace)}
                        className="qt-button qt-button-primary flex items-center gap-2"
                      >
                        {restoring ? (
                          <>
                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            Restoring...
                          </>
                        ) : (
                          'Start Restore'
                        )}
                      </button>
                    ) : (
                      <button
                        onClick={handleNext}
                        disabled={
                          loadingPreview ||
                          (step === 'source' && !selectedFile && !selectedS3Key)
                        }
                        className="qt-button qt-button-primary flex items-center gap-2"
                      >
                        {loadingPreview ? (
                          <>
                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            Loading...
                          </>
                        ) : (
                          'Next'
                        )}
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
