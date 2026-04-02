'use client'

import { useState } from 'react'
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
          <svg
            className="h-8 w-8 qt-text-info"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
        </div>
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-foreground mb-1">Import / Export</h2>
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
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
          Export Data
        </button>
        <button
          onClick={() => setShowImportDialog(true)}
          className="qt-button qt-button-secondary flex items-center justify-center gap-2"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
            />
          </svg>
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
