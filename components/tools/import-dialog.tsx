'use client'

import { useState } from 'react'
import { WizardModal } from '@/components/ui/WizardModal'
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

  const handleClose = () => {
    if (!state.importing) {
      setDragActive(false)
      actions.reset()
      onClose()
    }
  }

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
    <WizardModal
      onClose={handleClose}
      title="Import Data"
      step={{ current: getStepNumber(), total: 5 }}
      busy={state.importing}
      done={state.step === 'complete'}
      onBack={actions.handleBack}
      backDisabled={state.step === 'file'}
      hideActions={state.step === 'importing'}
      primary={
        state.step === 'options'
          ? {
              onClick: actions.handleImport,
              disabled: state.importing,
              label: state.importing ? (
                <>
                  <LoadingSpinner />
                  Importing...
                </>
              ) : (
                'Import'
              ),
            }
          : {
              onClick: actions.handleNext,
              disabled: (state.step === 'file' && !state.exportData) || state.loadingPreview,
              label: state.loadingPreview ? (
                <>
                  <LoadingSpinner />
                  Loading...
                </>
              ) : (
                'Next'
              ),
            }
      }
    >
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
    </WizardModal>
  )
}
