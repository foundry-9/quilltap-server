'use client'

import { useState } from 'react'
import { useImportData } from './import-export/hooks/useImportData'
import {
  LoadingSpinner,
  WizardLoadingStep,
  WizardErrorStep,
} from './import-export/components'
import {
  ImportFileStep,
  ImportPreviewStep,
  ImportOptionsStep,
  ImportCompleteStep,
} from './import-export/steps'

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

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    handleDragLeave(e)
    actions.handleFileDrop(e)
  }

  // Check if preview has memories
  const hasMemories = Boolean(
    state.preview?.entities?.memories &&
    (state.preview.entities.memories as { count?: number }).count &&
    (state.preview.entities.memories as { count?: number }).count! > 0
  )

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
                className="qt-text-secondary hover:text-foreground disabled:opacity-50"
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
              <ImportFileStep
                selectedFile={state.selectedFile}
                dragActive={dragActive}
                fileInputRef={fileInputRef}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onFileSelect={actions.handleFileSelect}
              />
            )}

            {/* Step 2: Preview */}
            {state.step === 'preview' && (
              <ImportPreviewStep
                loading={state.loadingPreview}
                preview={state.preview}
                selectedEntityIds={state.selectedEntityIds}
                onToggleSelection={actions.toggleEntitySelection}
              />
            )}

            {/* Step 3: Options */}
            {state.step === 'options' && (
              <ImportOptionsStep
                conflictStrategy={state.conflictStrategy}
                onConflictStrategyChange={actions.setConflictStrategy}
                importMemories={state.importMemories}
                onImportMemoriesChange={actions.setImportMemories}
                hasMemories={hasMemories}
              />
            )}

            {/* Step 4: Importing */}
            {state.step === 'importing' && (
              <WizardLoadingStep message="Importing data..." />
            )}

            {/* Step 5: Complete */}
            {state.step === 'complete' && state.importResult && (
              <ImportCompleteStep importResult={state.importResult} />
            )}

            {/* Error State */}
            {state.step === 'error' && (
              <WizardErrorStep
                title="Import Failed"
                error={state.error}
              />
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
