'use client'

import { useState } from 'react'
import { WizardModal } from '@/components/ui/WizardModal'
import { useExportData } from './import-export/hooks/useExportData'
import { ENTITY_TYPE_LABELS } from './import-export/types'
import {
  LoadingSpinner,
  WizardLoadingStep,
  WizardCompleteStep,
  WizardErrorStep,
} from './import-export/components'
import {
  ExportTypeStep,
  ExportSelectStep,
  ExportOptionsStep,
} from './import-export/steps'
import type { ExportEntityType } from '@/lib/export/types'

export function ExportDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean
  onClose: () => void
}) {
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

  const getStepNumber = (): number => {
    switch (state.step) {
      case 'type':
        return 1
      case 'select':
        return 2
      case 'options':
        return 3
      case 'exporting':
        return 4
      case 'complete':
        return 5
      default:
        return 1
    }
  }

  const getTotalSteps = (): number => {
    if (
      state.step === 'exporting' ||
      state.step === 'complete' ||
      state.step === 'error'
    ) {
      return 5
    }

    if (
      state.entityType === 'characters' ||
      state.entityType === 'chats'
    ) {
      return state.step === 'type' || state.step === 'select' ? 5 : 4
    }

    return 4
  }

  const filteredEntities = state.availableEntities.filter((entity) =>
    entity.name.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  const isExportStep =
    state.step === 'options' ||
    (state.step === 'select' && !!state.entityType && !['characters', 'chats'].includes(state.entityType))
  const nothingSelected =
    state.step === 'select' && state.scope === 'selected' && state.selectedIds.length === 0

  return (
    <WizardModal
      onClose={handleClose}
      title="Export Data"
      step={{ current: getStepNumber(), total: getTotalSteps() }}
      busy={state.exporting}
      done={state.step === 'complete'}
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
                  <LoadingSpinner />
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

      {/* Step 5: Complete */}
      {state.step === 'complete' && (
        <WizardCompleteStep
          title="Export Complete"
          description="Your data has been successfully exported and downloaded."
        />
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
