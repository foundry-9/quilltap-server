'use client'

import { useState } from 'react'
import { BackupDialog } from './backup-dialog'
import { RestoreDialog } from './restore'

export default function BackupRestoreCard() {
  const [showBackupDialog, setShowBackupDialog] = useState(false)
  const [showRestoreDialog, setShowRestoreDialog] = useState(false)

  return (
    <div className="qt-card p-6">
      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-foreground mb-1">
            Backup & Restore
          </h2>
          <p className="qt-text-small">
            Download a complete backup or restore from a previous backup file
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

      {/* Action Buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

      {/* Info Section */}
      <div className="mt-6 p-4 bg-muted/30 rounded-lg">
        <p className="qt-text-small">
          Backups include all your characters, chats, files, settings, and plugins.
          Store your backup files safely - they contain everything needed to restore your Quilltap environment.
        </p>
      </div>

      {/* Backup Dialog */}
      <BackupDialog
        isOpen={showBackupDialog}
        onClose={() => setShowBackupDialog(false)}
        onBackupComplete={() => {}}
      />

      {/* Restore Dialog */}
      <RestoreDialog
        isOpen={showRestoreDialog}
        onClose={() => setShowRestoreDialog(false)}
        onRestoreComplete={() => {}}
      />
    </div>
  )
}
