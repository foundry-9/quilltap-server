'use client'

import { useCallback, useEffect } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { getErrorMessage } from '@/lib/error-utils'
import { useDialogState } from '@/hooks/useDialogState'
import { useWizardState } from '@/hooks/useWizardState'
import type { ExportState, ExportStep, AvailableEntity } from '../types'
import type { ExportEntityType } from '@/lib/export/types'

interface UseExportDataOptions {
  isOpen: boolean
  onSuccess?: () => void
}

interface UseExportDataReturn {
  state: ExportState
  actions: {
    setEntityType: (type: ExportEntityType) => void
    setScope: (scope: 'all' | 'selected') => void
    toggleEntitySelection: (id: string) => void
    setIncludeMemories: (value: boolean) => void
    handleNext: () => Promise<void>
    handleBack: () => void
    handleExport: () => Promise<void>
    reset: () => void
  }
}

const initialState: ExportState = {
  step: 'type',
  entityType: null,
  scope: 'all',
  selectedIds: [],
  availableEntities: [],
  loadingEntities: false,
  includeMemories: false,
  memoryCount: 0,
  exporting: false,
  error: null,
}

// Helper to check if entity type supports memories
const supportsMemories = (type: ExportEntityType | null): boolean =>
  type === 'characters' || type === 'chats'

export function useExportData({
  isOpen,
  onSuccess,
}: UseExportDataOptions): UseExportDataReturn {
  const { state, setState, reset } = useDialogState({
    isOpen,
    initialState,
    logContext: 'useExportData',
  })

  // Wizard step configuration
  // Note: transitions vary based on entityType (characters/chats go through 'options')
  const wizard = useWizardState<ExportStep>(
    {
      initialStep: 'type',
      steps: {
        type: { next: ['select'] },
        select: { prev: 'type', next: ['options', 'exporting'] },
        options: { prev: 'select', next: ['exporting'] },
        exporting: { next: ['complete', 'error'] },
        complete: { isTerminal: true },
        error: { prev: 'select', isTerminal: true }, // Goes back to select or options based on entityType
      },
      logContext: 'useExportData',
    },
    state.step,
    (step) => setState((prev) => ({ ...prev, step }))
  )

  // Calculate memory count based on scope and selection
  useEffect(() => {
    // Only calculate for entity types that support memories
    if (!state.entityType || !['characters', 'chats'].includes(state.entityType)) {
      return
    }

    let newMemoryCount = 0
    if (state.scope === 'all') {
      // Sum all entity memory counts
      newMemoryCount = state.availableEntities.reduce(
        (sum, entity) => sum + (entity.memoryCount || 0),
        0
      )
    } else {
      // Sum only selected entity memory counts
      newMemoryCount = state.availableEntities
        .filter((entity) => state.selectedIds.includes(entity.id))
        .reduce((sum, entity) => sum + (entity.memoryCount || 0), 0)
    }

    // Only update if different to avoid infinite loops
    if (newMemoryCount !== state.memoryCount) {
      clientLogger.debug('Memory count recalculated', {
        context: 'useExportData',
        scope: state.scope,
        selectedCount: state.selectedIds.length,
        memoryCount: newMemoryCount,
      })
      setState((prev) => ({ ...prev, memoryCount: newMemoryCount }))
    }
  }, [state.scope, state.selectedIds, state.availableEntities, state.entityType, state.memoryCount, setState])

  const setEntityType = useCallback((type: ExportEntityType) => {
    clientLogger.debug('Entity type selected', {
      context: 'useExportData',
      entityType: type,
    })
    setState((prev) => ({
      ...prev,
      entityType: type,
      scope: 'all',
      selectedIds: [],
      error: null,
    }))
  }, [setState])

  const setScope = useCallback((scope: 'all' | 'selected') => {
    clientLogger.debug('Export scope changed', {
      context: 'useExportData',
      scope,
    })
    setState((prev) => ({
      ...prev,
      scope,
      selectedIds: scope === 'all' ? [] : prev.selectedIds,
    }))
  }, [setState])

  const toggleEntitySelection = useCallback((id: string) => {
    setState((prev) => {
      const newSelectedIds = prev.selectedIds.includes(id)
        ? prev.selectedIds.filter((selectedId) => selectedId !== id)
        : [...prev.selectedIds, id]

      clientLogger.debug('Entity selection toggled', {
        context: 'useExportData',
        entityId: id,
        isSelected: !prev.selectedIds.includes(id),
        totalSelected: newSelectedIds.length,
      })

      return {
        ...prev,
        selectedIds: newSelectedIds,
      }
    })
  }, [setState])

  const setIncludeMemories = useCallback((value: boolean) => {
    clientLogger.debug('Include memories toggled', {
      context: 'useExportData',
      includeMemories: value,
    })
    setState((prev) => ({
      ...prev,
      includeMemories: value,
    }))
  }, [setState])

  const loadAvailableEntities = useCallback(async (type: ExportEntityType) => {
    if (!type) return

    setState((prev) => ({ ...prev, loadingEntities: true, error: null }))

    try {
      clientLogger.debug('Loading available entities', {
        context: 'useExportData',
        entityType: type,
      })

      const response = await fetch(`/api/v1/system/tools?action=export-entities&type=${type}`)

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to load entities')
      }

      const data = await response.json()

      clientLogger.info('Available entities loaded', {
        context: 'useExportData',
        entityType: type,
        count: data.entities?.length || 0,
        memoryCount: data.memoryCount || 0,
      })

      setState((prev) => ({
        ...prev,
        availableEntities: data.entities || [],
        memoryCount: data.memoryCount || 0,
        loadingEntities: false,
      }))
    } catch (error) {
      const message = getErrorMessage(error)
      clientLogger.error('Failed to load entities', {
        context: 'useExportData',
        error: message,
      })
      setState((prev) => ({
        ...prev,
        loadingEntities: false,
        error: message,
      }))
    }
  }, [setState])

  const handleNext = useCallback(async () => {
    // Validation and step navigation based on current step
    switch (state.step) {
      case 'type':
        if (!state.entityType) {
          clientLogger.warn('Cannot proceed without entity type selected', {
            context: 'useExportData',
          })
          return
        }
        // Move to select step and load entities
        wizard.goTo('select')
        setState((prev) => ({ ...prev, loadingEntities: true }))
        await loadAvailableEntities(state.entityType)
        break

      case 'select':
        if (state.scope === 'selected' && state.selectedIds.length === 0) {
          clientLogger.warn('Cannot proceed without selecting entities', {
            context: 'useExportData',
          })
          return
        }
        // Use wizard for conditional navigation based on entity type
        if (supportsMemories(state.entityType)) {
          wizard.goTo('options')
        } else {
          wizard.goTo('exporting')
        }
        break

      case 'options':
        wizard.goNext() // Goes to 'exporting'
        break

      default:
        // No action for other steps
        break
    }
  }, [state.step, state.entityType, state.scope, state.selectedIds.length, wizard, loadAvailableEntities, setState])

  const handleBack = useCallback(() => {
    // Clear error state when going back
    setState((prev) => ({ ...prev, error: null }))

    // Handle conditional back navigation based on entityType
    if (state.step === 'exporting' || state.step === 'error') {
      // These steps go back to 'options' for memory-supporting types, or 'select' otherwise
      if (supportsMemories(state.entityType)) {
        wizard.goTo('options')
      } else {
        wizard.goTo('select')
      }
    } else {
      // Use standard back navigation for other steps
      wizard.goBack()
    }
  }, [state.step, state.entityType, wizard, setState])

  const handleExport = useCallback(async () => {
    if (!state.entityType) return

    // Use wizard for step navigation
    wizard.goTo('exporting')
    setState((prev) => ({ ...prev, exporting: true, error: null }))

    try {
      clientLogger.debug('Starting export', {
        context: 'useExportData',
        entityType: state.entityType,
        scope: state.scope,
        selectedCount: state.selectedIds.length,
        includeMemories: state.includeMemories,
      })

      const response = await fetch('/api/v1/system/tools?action=export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: state.entityType,
          scope: state.scope,
          selectedIds: state.scope === 'selected' ? state.selectedIds : undefined,
          includeMemories: state.includeMemories,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create export')
      }

      const exportData = await response.json()

      clientLogger.info('Export created successfully', {
        context: 'useExportData',
        entityType: state.entityType,
        exportSize: JSON.stringify(exportData).length,
      })

      // Trigger download
      const dataStr = JSON.stringify(exportData, null, 2)
      const dataBlob = new Blob([dataStr], { type: 'application/json' })
      const url = URL.createObjectURL(dataBlob)
      const link = document.createElement('a')
      link.href = url
      link.download = `quilltap-${state.entityType}-${new Date().toISOString().split('T')[0]}.qtap`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      wizard.goTo('complete')
      setState((prev) => ({
        ...prev,
        exporting: false,
      }))

      onSuccess?.()
    } catch (error) {
      const message = getErrorMessage(error)
      clientLogger.error('Failed to export', {
        context: 'useExportData',
        error: message,
      })
      wizard.goTo('error')
      setState((prev) => ({
        ...prev,
        exporting: false,
        error: message,
      }))
    }
  }, [state.entityType, state.scope, state.selectedIds, state.includeMemories, wizard, onSuccess, setState])

  return {
    state,
    actions: {
      setEntityType,
      setScope,
      toggleEntitySelection,
      setIncludeMemories,
      handleNext,
      handleBack,
      handleExport,
      reset,
    },
  }
}
