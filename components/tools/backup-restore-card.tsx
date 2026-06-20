'use client'

import { useState } from 'react'
import { BackupDialog } from './backup-dialog'
import { RestoreDialog } from './restore'
import { Icon } from '@/components/ui/icon'

export default function BackupRestoreCard() {
  const [showBackupDialog, setShowBackupDialog] = useState(false)
  const [showRestoreDialog, setShowRestoreDialog] = useState(false)

  return (
    <div className="qt-card p-6">
      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="flex-1">
          <h2 className="qt-heading-2 text-foreground mb-1">
            Backup & Restore
          </h2>
          <p className="qt-text-small">
            Download a complete backup or restore from a previous backup file
          </p>
        </div>
        <div className="flex-shrink-0 text-primary">
          <Icon name="upload" className="w-8 h-8" />
        </div>
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          onClick={() => setShowBackupDialog(true)}
          className="qt-button qt-button-primary flex items-center justify-center gap-2"
        >
          <Icon name="upload" className="w-5 h-5" />
          Create Backup
        </button>
        <button
          onClick={() => setShowRestoreDialog(true)}
          className="qt-button qt-button-secondary flex items-center justify-center gap-2"
        >
          <Icon name="download" className="w-5 h-5" />
          Restore from Backup
        </button>
      </div>

      {/* Info Section */}
      <div className="mt-6 p-4 qt-bg-muted/30 rounded-lg">
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
        onRestoreComplete={() => { window.location.reload() }}
      />
    </div>
  )
}
