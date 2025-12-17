'use client'

import { useState, useEffect } from 'react'
import { BackupDialog } from './backup-dialog'
import { RestoreDialog } from './restore'

interface BackupInfo {
  key: string
  filename: string
  createdAt: string
  size: number
}

export default function BackupRestoreCard() {
  const [showBackupDialog, setShowBackupDialog] = useState(false)
  const [showRestoreDialog, setShowRestoreDialog] = useState(false)
  const [selectedBackupKey, setSelectedBackupKey] = useState<string | undefined>(undefined)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deletingKey, setDeletingKey] = useState<string | null>(null)
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null)

  useEffect(() => {
    fetchBackups()
  }, [])

  const fetchBackups = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/tools/backup/list', {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' }
      })
      if (!res.ok) throw new Error('Failed to fetch backups')
      const data = await res.json()
      setBackups(data.backups || data)
      setError(null)
    } catch (err) {
      // Don't show error for empty list
      if (err instanceof Error && err.message !== 'Failed to fetch backups') {
        setError(err.message)
      }
      setBackups([])
    } finally {
      setLoading(false)
    }
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
  }

  const formatDate = (dateString: string): string => {
    try {
      return new Date(dateString).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    } catch {
      return dateString
    }
  }

  const handleRestoreFromBackup = (backupKey: string) => {
    setSelectedBackupKey(backupKey)
    setShowRestoreDialog(true)
  }

  const handleRestoreDialogClose = () => {
    setShowRestoreDialog(false)
    setSelectedBackupKey(undefined)
  }

  const handleDeleteBackup = async (backupKey: string) => {
    try {
      setDeletingKey(backupKey)
      setError(null)
      const res = await fetch('/api/tools/backup/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ s3Key: backupKey })
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete backup')
      }
      // Refresh the backup list
      await fetchBackups()
      setConfirmDeleteKey(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete backup')
    } finally {
      setDeletingKey(null)
    }
  }

  return (
    <div className="qt-card p-6">
      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-foreground mb-1">
            Backup & Restore
          </h2>
          <p className="qt-text-small">
            Export your data or restore from a previous backup
          </p>
        </div>
        <div className="flex-shrink-0 text-primary">
          <svg
            className="w-8 h-8"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
            />
          </svg>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-destructive/10 border border-destructive text-destructive px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {/* Action Buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        <button
          onClick={() => setShowBackupDialog(true)}
          className="qt-button qt-button-primary flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          Create Backup
        </button>
        <button
          onClick={() => setShowRestoreDialog(true)}
          className="qt-button qt-button-secondary flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Restore from Backup
        </button>
      </div>

      {/* Recent Backups Section */}
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-3">
          Cloud Backups
        </h3>

        {loading ? (
          <div className="text-center py-6 text-muted-foreground">
            <svg className="animate-spin h-6 w-6 mx-auto mb-2" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Loading backups...
          </div>
        ) : backups.length === 0 ? (
          <div className="qt-card p-6 text-center">
            <svg className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
            </svg>
            <p className="qt-text-small">No cloud backups yet. Create one to get started.</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[180px] overflow-y-auto">
            {backups.map((backup) => (
              <div
                key={backup.key}
                className="qt-card p-4 flex items-center justify-between hover:bg-muted/50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="qt-text-primary truncate">
                    {backup.filename}
                  </p>
                  <div className="flex gap-4 mt-1 qt-text-small">
                    <span>{formatDate(backup.createdAt)}</span>
                    <span>{formatFileSize(backup.size)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  {confirmDeleteKey === backup.key ? (
                    <>
                      <span className="qt-text-small">Delete?</span>
                      <button
                        onClick={() => handleDeleteBackup(backup.key)}
                        disabled={deletingKey === backup.key}
                        className="qt-button px-3 py-1.5 text-sm whitespace-nowrap bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                      >
                        {deletingKey === backup.key ? 'Deleting...' : 'Yes'}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteKey(null)}
                        disabled={deletingKey === backup.key}
                        className="qt-button qt-button-secondary px-3 py-1.5 text-sm whitespace-nowrap"
                      >
                        No
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => setConfirmDeleteKey(backup.key)}
                        className="qt-button qt-button-secondary px-3 py-1.5 text-sm whitespace-nowrap text-destructive hover:bg-destructive/10"
                        title="Delete backup"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => handleRestoreFromBackup(backup.key)}
                        className="qt-button qt-button-secondary px-3 py-1.5 text-sm whitespace-nowrap"
                      >
                        Restore
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Backup Dialog */}
      <BackupDialog
        isOpen={showBackupDialog}
        onClose={() => setShowBackupDialog(false)}
        onBackupComplete={fetchBackups}
      />

      {/* Restore Dialog */}
      <RestoreDialog
        isOpen={showRestoreDialog}
        onClose={handleRestoreDialogClose}
        onRestoreComplete={fetchBackups}
        initialS3Key={selectedBackupKey}
      />
    </div>
  )
}
