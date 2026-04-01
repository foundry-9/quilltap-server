'use client'

import { useState } from 'react'
import { useImportData } from './import-export/hooks/useImportData'
import { ENTITY_TYPE_LABELS } from './import-export/types'
import type { ExportEntityType } from '@/lib/export/types'

function LoadingSpinner() {
  return (
    <svg className="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
}

function formatDate(dateString: string): string {
  try {
    return new Date(dateString).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return dateString
  }
}

// Map camelCase entity keys from API to kebab-case ExportEntityType
function toExportEntityType(key: string): ExportEntityType {
  const mapping: Record<string, ExportEntityType> = {
    characters: 'characters',
    personas: 'personas',
    chats: 'chats',
    tags: 'tags',
    connectionProfiles: 'connection-profiles',
    imageProfiles: 'image-profiles',
    embeddingProfiles: 'embedding-profiles',
    roleplayTemplates: 'roleplay-templates',
  }
  return mapping[key] || (key as ExportEntityType)
}

export function ImportDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean
  onClose: () => void
}) {
  const { state, fileInputRef, actions } = useImportData({
    isOpen,
    // Don't pass onClose as onSuccess - let user see the complete step
  })
  const [dragActive, setDragActive] = useState(false)

  if (!isOpen) return null

  const getStepNumber = (): number => {
    switch (state.step) {
      case 'file':
        return 1
      case 'preview':
        return 2
      case 'options':
        return 3
      case 'importing':
        return 4
      case 'complete':
        return 5
      default:
        return 1
    }
  }

  const handleClose = () => {
    if (!state.importing) {
      setDragActive(false)
      actions.reset()
      onClose()
    }
  }

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(true)
  }

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
  }

  // Get entity keys from preview (camelCase from API)
  const getEntityKeysInPreview = (): string[] => {
    if (!state.preview) return []
    const entities = state.preview.entities || {}
    return Object.keys(entities).filter(
      (key) => key !== 'memories' && (entities as Record<string, unknown>)[key],
    )
  }

  return (
    <>
      {/* Overlay */}
      <button
        className="qt-dialog-overlay !p-0 cursor-default border-none z-40"
        onClick={handleClose}
        disabled={state.importing}
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
                <h2 className="qt-dialog-title">Import Data</h2>
                <p className="qt-dialog-description mt-0.5">
                  Step {getStepNumber()} of 5
                </p>
              </div>
              <button
                onClick={handleClose}
                disabled={state.importing}
                className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                aria-label="Close dialog"
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="qt-dialog-body overflow-y-auto flex-1">
            {/* Step 1: File Selection */}
            {state.step === 'file' && (
              <div className="space-y-4">
                <p className="qt-text-small text-muted-foreground">
                  Select a Quilltap export file (.qtap) to import.
                </p>

                <div
                  className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                    dragActive
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-primary/50'
                  }`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDragOver={handleDragOver}
                  onDrop={(e) => {
                    handleDragLeave(e)
                    actions.handleFileDrop(e)
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".qtap,.json"
                    onChange={actions.handleFileSelect}
                    className="hidden"
                  />
                  <svg
                    className="w-12 h-12 mx-auto mb-3 text-muted-foreground"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M12 16v-4m0-4v4m0 0l3.09-3.09m-6.18 0L12 12m0 0l-3.09-3.09m6.18 0L12 12"
                    />
                  </svg>
                  <p className="text-foreground font-medium">
                    Drag and drop a .qtap file here
                  </p>
                  <p className="text-muted-foreground text-sm mt-1">
                    or click to browse
                  </p>
                </div>

                {state.selectedFile && (
                  <div className="p-4 bg-muted/50 rounded-lg">
                    <p className="font-medium text-foreground truncate">
                      {state.selectedFile.name}
                    </p>
                    <p className="qt-text-small text-muted-foreground mt-1">
                      {formatFileSize(state.selectedFile.size)}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Step 2: Preview */}
            {state.step === 'preview' && (
              <div className="space-y-4">
                {state.loadingPreview ? (
                  <div className="flex justify-center py-8">
                    <LoadingSpinner />
                  </div>
                ) : state.preview ? (
                  <>
                    {/* Manifest Info */}
                    <div className="p-4 bg-muted/50 rounded-lg space-y-2">
                      <div>
                        <p className="qt-text-small text-muted-foreground">Export Type</p>
                        <p className="font-medium text-foreground">
                          {state.preview.manifest.exportType}
                        </p>
                      </div>
                      <div>
                        <p className="qt-text-small text-muted-foreground">Created</p>
                        <p className="font-medium text-foreground">
                          {formatDate(state.preview.manifest.createdAt)}
                        </p>
                      </div>
                      <div>
                        <p className="qt-text-small text-muted-foreground">App Version</p>
                        <p className="font-medium text-foreground">
                          {state.preview.manifest.appVersion}
                        </p>
                      </div>
                    </div>

                    {/* Entity Lists */}
                    <div className="space-y-3 max-h-96 overflow-y-auto">
                      {getEntityKeysInPreview().map((entityKey) => {
                        const entities = (state.preview?.entities || {})[entityKey] || []
                        if (!entities || entities.length === 0) return null

                        const selectedCount = (
                          state.selectedEntityIds[entityKey] || []
                        ).length
                        const displayType = toExportEntityType(entityKey)

                        return (
                          <div
                            key={entityKey}
                            className="p-4 border border-border rounded-lg space-y-2"
                          >
                            <div className="flex items-center justify-between">
                              <h4 className="font-medium text-foreground">
                                {ENTITY_TYPE_LABELS[displayType]}
                              </h4>
                              <span className="qt-text-small text-muted-foreground">
                                {selectedCount} of {entities.length}
                              </span>
                            </div>
                            <div className="space-y-1 max-h-32 overflow-y-auto">
                              {entities.map(
                                (entity: {
                                  id: string
                                  name?: string
                                  title?: string
                                  exists: boolean
                                }) => (
                                  <label
                                    key={entity.id}
                                    className="flex items-center gap-2 p-2 hover:bg-muted/50 rounded cursor-pointer"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={(
                                        state.selectedEntityIds[entityKey] || []
                                      ).includes(entity.id)}
                                      onChange={() =>
                                        actions.toggleEntitySelection(entityKey, entity.id)
                                      }
                                      className="w-4 h-4"
                                    />
                                    <span className="text-foreground flex-1">
                                      {entity.name || entity.title}
                                    </span>
                                    {entity.exists && (
                                      <span className="text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 px-2 py-1 rounded">
                                        Exists
                                      </span>
                                    )}
                                  </label>
                                ),
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </>
                ) : null}
              </div>
            )}

            {/* Step 3: Options */}
            {state.step === 'options' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Conflict Strategy
                  </label>
                  <select
                    value={state.conflictStrategy}
                    onChange={(e) =>
                      actions.setConflictStrategy(
                        e.target.value as 'skip' | 'overwrite' | 'duplicate',
                      )
                    }
                    className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="skip">Skip existing entities (default)</option>
                    <option value="overwrite">Overwrite existing entities</option>
                    <option value="duplicate">Import as duplicates</option>
                  </select>
                  <p className="qt-text-small text-muted-foreground mt-2">
                    {state.conflictStrategy === 'skip' &&
                      'Existing entities will be kept unchanged.'}
                    {state.conflictStrategy === 'overwrite' &&
                      'Existing entities will be overwritten with imported versions.'}
                    {state.conflictStrategy === 'duplicate' &&
                      'Imported entities will be created with new IDs.'}
                  </p>
                </div>

                {(state.preview?.entities?.memories as any)?.length > 0 || (state.preview?.entities?.memories as any)?.[0]?.id ? (
                  <label className="flex items-start gap-3 p-4 border border-border rounded-lg cursor-pointer hover:bg-muted/50">
                    <input
                      type="checkbox"
                      checked={state.importMemories}
                      onChange={(e) => actions.setImportMemories(e.target.checked)}
                      className="w-4 h-4 mt-1"
                    />
                    <div className="flex-1">
                      <p className="font-medium text-foreground">
                        Import associated memories
                      </p>
                      <p className="qt-text-small text-muted-foreground mt-1">
                        Memories will be included in the import
                      </p>
                    </div>
                  </label>
                ) : null}
              </div>
            )}

            {/* Step 4: Importing */}
            {state.step === 'importing' && (
              <div className="flex flex-col items-center justify-center py-12">
                <LoadingSpinner />
                <p className="mt-4 text-foreground font-medium">Importing data...</p>
              </div>
            )}

            {/* Step 5: Complete */}
            {state.step === 'complete' && state.importResult && (
              <div className="space-y-4">
                <div className="flex flex-col items-center justify-center py-6">
                  <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4">
                    <svg
                      className="w-6 h-6 text-green-600 dark:text-green-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">
                    Import Complete
                  </h3>
                </div>

                {/* Import Summary */}
                <div className="p-4 bg-muted/50 rounded-lg space-y-2">
                  {Object.entries(state.importResult.imported).map(([key, value]) => {
                    if (value === 0) return null
                    return (
                      <div key={key} className="flex justify-between">
                        <span className="text-foreground capitalize">
                          {key.replace(/([A-Z])/g, ' $1').trim()}
                        </span>
                        <span className="font-medium text-green-600 dark:text-green-400">
                          +{value}
                        </span>
                      </div>
                    )
                  })}
                  {Object.entries(state.importResult.skipped || {}).map(([key, value]) => {
                    if (value === 0) return null
                    return (
                      <div key={`skipped-${key}`} className="flex justify-between">
                        <span className="text-foreground capitalize">
                          {key.replace(/([A-Z])/g, ' $1').trim()} (skipped)
                        </span>
                        <span className="font-medium text-muted-foreground">
                          {value}
                        </span>
                      </div>
                    )
                  })}
                </div>

                {/* Warnings */}
                {state.importResult.warnings && state.importResult.warnings.length > 0 && (
                  <div className="p-4 bg-yellow-100/20 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                    <h4 className="font-medium text-yellow-800 dark:text-yellow-200 mb-2">
                      Warnings
                    </h4>
                    <ul className="space-y-1">
                      {state.importResult.warnings.map((warning, idx) => (
                        <li key={idx} className="text-sm text-yellow-700 dark:text-yellow-300">
                          • {warning}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Error State */}
            {state.step === 'error' && (
              <div className="space-y-4">
                <div className="flex flex-col items-center justify-center py-6">
                  <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4">
                    <svg
                      className="w-6 h-6 text-red-600 dark:text-red-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">
                    Import Failed
                  </h3>
                </div>
                {state.error && (
                  <div className="p-3 bg-destructive/10 border border-destructive rounded-lg">
                    <p className="text-sm text-destructive">{state.error}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="qt-dialog-footer flex gap-3 justify-between flex-shrink-0">
            {state.step === 'complete' ? (
              <button onClick={handleClose} className="flex-1 qt-button qt-button-primary">
                Close
              </button>
            ) : (
              <>
                <button
                  onClick={actions.handleBack}
                  disabled={state.step === 'file' || state.importing}
                  className="qt-button qt-button-secondary"
                >
                  Back
                </button>

                {state.step === 'importing' ? null : (
                  <>
                    <button
                      onClick={handleClose}
                      disabled={state.importing}
                      className="qt-button qt-button-secondary"
                    >
                      Cancel
                    </button>

                    {state.step === 'options' ? (
                      <button
                        onClick={actions.handleImport}
                        disabled={state.importing}
                        className="qt-button qt-button-primary"
                      >
                        {state.importing ? (
                          <>
                            <LoadingSpinner />
                            Importing...
                          </>
                        ) : (
                          'Import'
                        )}
                      </button>
                    ) : (
                      <button
                        onClick={actions.handleNext}
                        disabled={
                          (state.step === 'file' && !state.exportData) ||
                          state.loadingPreview
                        }
                        className="qt-button qt-button-primary"
                      >
                        {state.loadingPreview ? (
                          <>
                            <LoadingSpinner />
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
