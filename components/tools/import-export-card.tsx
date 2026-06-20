'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { ExportDialog } from './export-dialog'
import { ImportDialog } from './import-dialog'

export function ImportExportCard() {
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [showImportDialog, setShowImportDialog] = useState(false)

  return (
    <div className="qt-card p-6">
      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="p-3 rounded-lg qt-bg-info/10">
          <Icon name="cloud-upload" className="h-8 w-8 qt-text-info" />
        </div>
        <div className="flex-1">
          <h2 className="qt-heading-2 text-foreground mb-1">Import / Export</h2>
          <p className="qt-text-small">
            Export individual entity types or import from Quilltap export files (.qtap)
          </p>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          onClick={() => setShowExportDialog(true)}
          className="qt-button qt-button-primary flex items-center justify-center gap-2"
        >
          <Icon name="download" className="h-5 w-5" />
          Export Data
        </button>
        <button
          onClick={() => setShowImportDialog(true)}
          className="qt-button qt-button-secondary flex items-center justify-center gap-2"
        >
          <Icon name="upload" className="h-5 w-5" />
          Import Data
        </button>
      </div>

      {/* Dialogs */}
      <ExportDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
      />
      <ImportDialog
        isOpen={showImportDialog}
        onClose={() => setShowImportDialog(false)}
      />
    </div>
  )
}
