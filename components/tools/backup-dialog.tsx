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
        className="fixed inset-0 bg-black bg-opacity-50 z-40 cursor-default border-none p-0"
        onClick={handleClose}
        aria-label="Close dialog"
        type="button"
      />

      {/* Dialog */}
      <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-auto">
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-md">
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Create Backup</h2>
              <button
                onClick={handleClose}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                aria-label="Close dialog"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Back up your data to restore it later
            </p>
          </div>

          {/* Body */}
          <div className="px-6 py-6 space-y-6">
            {/* Destination Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Backup Destination
              </label>
              <div className="space-y-3">
                {/* Download Option */}
                <label className={`flex items-center p-3 border-2 rounded-lg cursor-pointer transition-colors ${
                    destination === 'download'
                      ? 'border-blue-500 bg-blue-50 dark:border-blue-600 dark:bg-blue-900/20'
                      : 'border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700/50'
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
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      Download to Computer
                    </p>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                      Save backup as a ZIP file to your device
                    </p>
                  </div>
                </label>

                {/* S3 Option */}
                <label className={`flex items-center p-3 border-2 rounded-lg cursor-pointer transition-colors ${
                  destination === 's3'
                    ? 'border-blue-500 bg-blue-50 dark:border-blue-600 dark:bg-blue-900/20'
                    : 'border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700/50'
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
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      Save to Cloud Storage (S3)
                    </p>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                      Store backup in your configured cloud storage
                    </p>
                  </div>
                </label>
              </div>
            </div>

            {/* Filename Input (S3 only) */}
            {destination === 's3' && (
              <div>
                <label htmlFor="filename" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Filename (optional)
                </label>
                <input
                  id="filename"
                  type="text"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  placeholder="backup-2025-12-07"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                  Leave empty to use default name with timestamp
                </p>
              </div>
            )}

            {/* Error Display */}
            {error && (
              <div className="p-3 bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-700 rounded-lg">
                <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 bg-gray-50 dark:bg-slate-900 border-t border-gray-200 dark:border-slate-700 flex gap-3 justify-end">
            <button
              onClick={handleClose}
              disabled={loading}
              className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-slate-700 hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleCreateBackup}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded-lg text-sm font-medium hover:bg-blue-700 dark:hover:bg-blue-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
