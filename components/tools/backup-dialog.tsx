'use client'

import { useState } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { showSuccessToast, showErrorToast } from '@/lib/toast'

interface BackupDialogProps {
  isOpen: boolean
  onClose: () => void
  onBackupComplete: () => void
}

type BackupDestination = 'download' | 's3'

export function BackupDialog({ isOpen, onClose, onBackupComplete }: BackupDialogProps) {
  const [destination, setDestination] = useState<BackupDestination>('download')
  const [filename, setFilename] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const handleCreateBackup = async () => {
    setError(null)
    setLoading(true)

    try {
      clientLogger.info('Starting backup creation', { destination, hasFilename: !!filename })

      const body: Record<string, any> = {
        destination,
      }

      if (destination === 's3' && filename) {
        body.filename = filename
      }

      const response = await fetch('/api/tools/backup/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create backup')
      }

      clientLogger.info('Backup created successfully', {
        destination,
        backupId: data.backupId,
      })

      if (destination === 'download' && data.backupId) {
        // Trigger download
        const downloadUrl = `/api/tools/backup/download?backupId=${data.backupId}`
        const link = document.createElement('a')
        link.href = downloadUrl
        link.download = data.filename || `quilltap-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)

        showSuccessToast('Backup downloaded successfully')
      } else if (destination === 's3') {
        showSuccessToast('Backup saved to cloud storage')
      }

      // Reset form
      setDestination('download')
      setFilename('')

      // Call completion callback
      onBackupComplete()

      // Close dialog
      onClose()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create backup'
      setError(errorMessage)
      clientLogger.error('Backup creation failed', { error: errorMessage })
      showErrorToast(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setError(null)
    setDestination('download')
    setFilename('')
    onClose()
  }

  return (
    <>
      {/* Overlay */}
      <button
        className="qt-dialog-overlay !p-0 cursor-default border-none z-40"
        onClick={handleClose}
        aria-label="Close dialog"
        type="button"
      />

      {/* Dialog */}
      <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-auto">
        <div className="qt-dialog max-w-md">
          {/* Header */}
          <div className="qt-dialog-header">
            <div className="flex items-center justify-between">
              <h2 className="qt-dialog-title">Create Backup</h2>
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
            <p className="qt-dialog-description">
              Back up your data to restore it later
            </p>
          </div>

          {/* Body */}
          <div className="qt-dialog-body space-y-6">
            {/* Destination Selection */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-3">
                Backup Destination
              </label>
              <div className="space-y-3">
                {/* Download Option */}
                <label className={`flex items-center p-3 border-2 rounded-lg cursor-pointer transition-colors ${
                    destination === 'download'
                      ? 'border-primary bg-accent'
                      : 'border-border bg-background'
                  }`}
                >
                  <input
                    type="radio"
                    name="destination"
                    value="download"
                    checked={destination === 'download'}
                    onChange={(e) => setDestination(e.target.value as BackupDestination)}
                    className="w-4 h-4"
                  />
                  <div className="ml-3">
                    <p className="text-sm font-medium text-foreground">
                      Download to Computer
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Save backup as a ZIP file to your device
                    </p>
                  </div>
                </label>

                {/* S3 Option */}
                <label className={`flex items-center p-3 border-2 rounded-lg cursor-pointer transition-colors ${
                  destination === 's3'
                    ? 'border-primary bg-accent'
                    : 'border-border bg-background'
                }`}>
                  <input
                    type="radio"
                    name="destination"
                    value="s3"
                    checked={destination === 's3'}
                    onChange={(e) => setDestination(e.target.value as BackupDestination)}
                    className="w-4 h-4"
                  />
                  <div className="ml-3">
                    <p className="text-sm font-medium text-foreground">
                      Save to Cloud Storage (S3)
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Store backup in your configured cloud storage
                    </p>
                  </div>
                </label>
              </div>
            </div>

            {/* Filename Input (S3 only) */}
            {destination === 's3' && (
              <div>
                <label htmlFor="filename" className="block text-sm font-medium text-foreground mb-2">
                  Filename (optional)
                </label>
                <input
                  id="filename"
                  type="text"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  placeholder="backup-2025-12-07"
                  className="qt-input"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Leave empty to use default name with timestamp
                </p>
              </div>
            )}

            {/* Error Display */}
            {error && (
              <div className="p-3 bg-destructive/10 border border-destructive rounded-lg">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="qt-dialog-footer">
            <button
              onClick={handleClose}
              disabled={loading}
              className="qt-button-secondary"
            >
              Cancel
            </button>
            <button
              onClick={handleCreateBackup}
              disabled={loading}
              className="qt-button-primary flex items-center gap-2"
            >
              {loading && (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              )}
              Create Backup
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
