'use client'

import { useState } from 'react'
import { useExportData } from './import-export/hooks/useExportData'
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

function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
    />
  )
}

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
      state.entityType === 'personas' ||
      state.entityType === 'chats'
    ) {
      return state.step === 'type' || state.step === 'select' ? 5 : 4
    }

    return 4
  }

  const filteredEntities = state.availableEntities.filter((entity) =>
    entity.name.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  const handleClose = () => {
    if (!state.exporting) {
      setSearchQuery('')
      actions.reset()
      onClose()
    }
  }

  return (
    <>
      {/* Overlay */}
      <button
        className="qt-dialog-overlay !p-0 cursor-default border-none z-40"
        onClick={handleClose}
        disabled={state.exporting}
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
                <h2 className="qt-dialog-title">Export Data</h2>
                <p className="qt-dialog-description mt-0.5">
                  Step {getStepNumber()} of {getTotalSteps()}
                </p>
              </div>
              <button
                onClick={handleClose}
                disabled={state.exporting}
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
            {/* Step 1: Type Selection */}
            {state.step === 'type' && (
              <div className="space-y-4">
                <p className="qt-text-small text-muted-foreground">
                  Select the type of data you want to export.
                </p>
                <div className="space-y-2">
                  {(Object.keys(ENTITY_TYPE_LABELS) as ExportEntityType[]).map(
                    (type) => (
                      <label
                        key={type}
                        className={`flex items-center p-4 border-2 rounded-lg cursor-pointer transition-colors ${
                          state.entityType === type
                            ? 'border-primary bg-accent'
                            : 'border-border bg-background hover:border-primary/50'
                        }`}
                      >
                        <input
                          type="radio"
                          name="entity-type"
                          value={type}
                          checked={state.entityType === type}
                          onChange={() => actions.setEntityType(type)}
                          className="w-4 h-4"
                        />
                        <span className="ml-3 font-medium text-foreground">
                          {ENTITY_TYPE_LABELS[type]}
                        </span>
                      </label>
                    ),
                  )}
                </div>
              </div>
            )}

            {/* Step 2: Entity Selection */}
            {state.step === 'select' && (
              <div className="space-y-4">
                <div className="space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="scope"
                      value="all"
                      checked={state.scope === 'all'}
                      onChange={() => actions.setScope('all')}
                      className="w-4 h-4"
                    />
                    <span className="font-medium text-foreground">Export All</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="scope"
                      value="selected"
                      checked={state.scope === 'selected'}
                      onChange={() => actions.setScope('selected')}
                      className="w-4 h-4"
                    />
                    <span className="font-medium text-foreground">Select Specific</span>
                  </label>
                </div>

                {state.scope === 'selected' && (
                  <div className="space-y-3 mt-4 pt-4 border-t border-border">
                    <SearchInput
                      value={searchQuery}
                      onChange={setSearchQuery}
                      placeholder="Search entities..."
                    />

                    {state.loadingEntities ? (
                      <div className="flex justify-center py-6">
                        <LoadingSpinner />
                      </div>
                    ) : filteredEntities.length === 0 ? (
                      <div className="text-center py-6 text-muted-foreground">
                        No entities found
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {filteredEntities.map((entity) => (
                          <label
                            key={entity.id}
                            className="flex items-center gap-3 p-2 hover:bg-muted/50 rounded cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={state.selectedIds.includes(entity.id)}
                              onChange={() => actions.toggleEntitySelection(entity.id)}
                              className="w-4 h-4"
                            />
                            <span className="text-foreground">{entity.name}</span>
                          </label>
                        ))}
                      </div>
                    )}

                    <div className="text-sm text-muted-foreground pt-2">
                      {state.selectedIds.length} of {state.availableEntities.length} selected
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Step 3: Export Options */}
            {state.step === 'options' && (
              <div className="space-y-4">
                <p className="qt-text-small text-muted-foreground">
                  Configure export options
                </p>
                <label className="flex items-start gap-3 p-4 border border-border rounded-lg cursor-pointer hover:bg-muted/50">
                  <input
                    type="checkbox"
                    checked={state.includeMemories}
                    onChange={(e) => actions.setIncludeMemories(e.target.checked)}
                    className="w-4 h-4 mt-1"
                  />
                  <div className="flex-1">
                    <p className="font-medium text-foreground">
                      Include associated memories
                    </p>
                    {state.memoryCount > 0 && (
                      <p className="qt-text-small text-muted-foreground mt-1">
                        {state.memoryCount} memories will be included
                      </p>
                    )}
                  </div>
                </label>
              </div>
            )}

            {/* Step 4: Exporting */}
            {state.step === 'exporting' && (
              <div className="flex flex-col items-center justify-center py-12">
                <LoadingSpinner />
                <p className="mt-4 text-foreground font-medium">Creating export...</p>
              </div>
            )}

            {/* Step 5: Complete */}
            {state.step === 'complete' && (
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
                    Export Complete
                  </h3>
                  <p className="qt-text-small text-muted-foreground mt-2 text-center">
                    Your data has been successfully exported and downloaded.
                  </p>
                </div>
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
                    Export Failed
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
                  disabled={state.step === 'type' || state.exporting}
                  className="qt-button qt-button-secondary"
                >
                  Back
                </button>

                {state.step === 'exporting' ? null : (
                  <>
                    <button
                      onClick={handleClose}
                      disabled={state.exporting}
                      className="qt-button qt-button-secondary"
                    >
                      Cancel
                    </button>

                    {state.step === 'options' || (state.step === 'select' && state.entityType && !['characters', 'personas', 'chats'].includes(state.entityType)) ? (
                      <button
                        onClick={actions.handleExport}
                        disabled={
                          state.exporting ||
                          (state.step === 'select' &&
                            state.scope === 'selected' &&
                            state.selectedIds.length === 0)
                        }
                        className="qt-button qt-button-primary"
                      >
                        {state.exporting ? (
                          <>
                            <LoadingSpinner />
                            Exporting...
                          </>
                        ) : (
                          'Export'
                        )}
                      </button>
                    ) : (
                      <button
                        onClick={actions.handleNext}
                        disabled={
                          state.step === 'type' && !state.entityType ||
                          (state.step === 'select' &&
                            state.scope === 'selected' &&
                            state.selectedIds.length === 0)
                        }
                        className="qt-button qt-button-primary"
                      >
                        Next
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
