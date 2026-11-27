'use client'

import { useState } from 'react'
import { WizardModal, wizardStep } from '@/components/ui/WizardModal'
import { useImportData } from './import-export/hooks/useImportData'
import { Spinner } from '@/components/ui/Spinner'
import { WizardErrorStep } from './import-export/components'
import { IMPORT_STEPS } from './import-export/types'
import { previewHasMemories } from './import-export/utils'
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

  const hasMemories = previewHasMemories(state.preview)

  return (
    <WizardModal
      onClose={handleClose}
      title="Import Data"
      step={wizardStep(IMPORT_STEPS, state.step === 'error' ? 'importing' : state.step)}
      busy={state.importing}
      done={state.step === 'complete'}
      onBack={actions.handleBack}
      backDisabled={state.step === 'file'}
      primary={
        state.step === 'options'
          ? {
              onClick: actions.handleImport,
              disabled: state.importing,
              label: state.importing ? (
                <>
                  <Spinner className="w-6 h-6" />
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
                  <Spinner className="w-6 h-6" />
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
