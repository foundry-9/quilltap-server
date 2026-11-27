'use client'

import { useState } from 'react'
import { WizardModal, wizardStep } from '@/components/ui/WizardModal'
import { useExportData } from './import-export/hooks/useExportData'
import { EXPORT_STEPS, EXPORT_STEPS_WITH_OPTIONS, supportsMemories } from './import-export/types'
import { Spinner } from '@/components/ui/Spinner'
import {
  WizardLoadingStep,
  WizardErrorStep,
} from './import-export/components'
import {
  ExportTypeStep,
  ExportSelectStep,
  ExportOptionsStep,
} from './import-export/steps'

export function ExportDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean
  onClose: () => void
}) {
  // A finished export closes the dialog: the download is the confirmation.
  const { state, actions } = useExportData({
    isOpen,
    onSuccess: onClose,
  })
  const [searchQuery, setSearchQuery] = useState('')

  const handleClose = () => {
    if (!state.exporting) {
      setSearchQuery('')
      actions.reset()
      onClose()
    }
  }

  if (!isOpen) return null

  // A failed export counts as the exporting step it failed at.
  const stepOrder = supportsMemories(state.entityType) ? EXPORT_STEPS_WITH_OPTIONS : EXPORT_STEPS
  const step = wizardStep(stepOrder, state.step === 'error' ? 'exporting' : state.step)

  const filteredEntities = state.availableEntities.filter((entity) =>
    entity.name.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  const isExportStep =
    state.step === 'options' ||
    (state.step === 'select' && !!state.entityType && !supportsMemories(state.entityType))
  const nothingSelected =
    state.step === 'select' && state.scope === 'selected' && state.selectedIds.length === 0

  return (
    <WizardModal
      onClose={handleClose}
      title="Export Data"
      step={step}
      busy={state.exporting}
      onBack={actions.handleBack}
      backDisabled={state.step === 'type'}
      hideActions={state.step === 'exporting'}
      primary={
        isExportStep
          ? {
              onClick: actions.handleExport,
              disabled: state.exporting || nothingSelected,
              label: state.exporting ? (
                <>
                  <Spinner className="w-6 h-6" />
                  Exporting...
                </>
              ) : (
                'Export'
              ),
            }
          : {
              onClick: actions.handleNext,
              disabled: (state.step === 'type' && !state.entityType) || nothingSelected,
              label: 'Next',
            }
      }
    >
      {/* Step 1: Type Selection */}
      {state.step === 'type' && (
        <ExportTypeStep
          entityType={state.entityType}
          onEntityTypeChange={actions.setEntityType}
        />
      )}

      {/* Step 2: Entity Selection */}
      {state.step === 'select' && (
        <ExportSelectStep
          scope={state.scope}
          onScopeChange={actions.setScope}
          selectedIds={state.selectedIds}
          onToggleSelection={actions.toggleEntitySelection}
          availableEntities={state.availableEntities}
          filteredEntities={filteredEntities}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          loadingEntities={state.loadingEntities}
        />
      )}

      {/* Step 3: Export Options */}
      {state.step === 'options' && (
        <ExportOptionsStep
          includeMemories={state.includeMemories}
          onIncludeMemoriesChange={actions.setIncludeMemories}
          memoryCount={state.memoryCount}
          vaultPreview={state.vaultPreview}
        />
      )}

      {/* Step 4: Exporting */}
      {state.step === 'exporting' && (
        <WizardLoadingStep message="Creating export..." />
      )}

      {/* Error State */}
      {state.step === 'error' && (
        <WizardErrorStep
          title="Export Failed"
          error={state.error}
        />
      )}
    </WizardModal>
  )
}
