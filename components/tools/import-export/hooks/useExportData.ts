'use client'

import { useCallback, useEffect } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { getErrorMessage } from '@/lib/error-utils'
import { useDialogState } from '@/hooks/useDialogState'
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

export function useExportData({
  isOpen,
  onSuccess,
}: UseExportDataOptions): UseExportDataReturn {
  const { state, setState, reset } = useDialogState({
    isOpen,
    initialState,
    logContext: 'useExportData',
  })

  // Calculate memory count based on scope and selection
  useEffect(() => {
    // Only calculate for entity types that support memories
    if (!state.entityType || !['characters', 'personas', 'chats'].includes(state.entityType)) {
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
  }, [state.scope, state.selectedIds, state.availableEntities, state.entityType, state.memoryCount])

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
  }, [])

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
  }, [])

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
  }, [])

  const setIncludeMemories = useCallback((value: boolean) => {
    clientLogger.debug('Include memories toggled', {
      context: 'useExportData',
      includeMemories: value,
    })
    setState((prev) => ({
      ...prev,
      includeMemories: value,
    }))
  }, [])

  const loadAvailableEntities = useCallback(async (type: ExportEntityType) => {
    if (!type) return

    setState((prev) => ({ ...prev, loadingEntities: true, error: null }))

    try {
      clientLogger.debug('Loading available entities', {
        context: 'useExportData',
        entityType: type,
      })

      const response = await fetch(`/api/tools/quilltap-export/entities?type=${type}`)

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
  }, [])

  const handleNext = useCallback(async () => {
    // Determine if we need to load entities
    const shouldLoadEntities = state.step === 'type' && state.entityType

    setState((prev) => {
      let nextStep: ExportStep = prev.step

      switch (prev.step) {
        case 'type':
          if (!prev.entityType) {
            clientLogger.warn('Cannot proceed without entity type selected', {
              context: 'useExportData',
            })
            return prev
          }
          nextStep = 'select'
          break
        case 'select':
          if (prev.scope === 'selected' && prev.selectedIds.length === 0) {
            clientLogger.warn('Cannot proceed without selecting entities', {
              context: 'useExportData',
            })
            return prev
          }
          // Only show options step for entities that support memories
          nextStep =
            prev.entityType === 'characters' ||
            prev.entityType === 'personas' ||
            prev.entityType === 'chats'
              ? 'options'
              : 'exporting'
          break
        case 'options':
          nextStep = 'exporting'
          break
        default:
          return prev
      }

      clientLogger.debug('Moving to next step', {
        context: 'useExportData',
        currentStep: prev.step,
        nextStep,
      })

      // If moving to select step, set loading state
      if (nextStep === 'select') {
        return { ...prev, step: nextStep, loadingEntities: true }
      }

      return { ...prev, step: nextStep }
    })

    // Load entities when moving to select step
    if (shouldLoadEntities) {
      await loadAvailableEntities(state.entityType!)
    }
  }, [state.step, state.entityType, loadAvailableEntities])

  const handleBack = useCallback(() => {
    setState((prev) => {
      let previousStep: ExportStep = prev.step

      switch (prev.step) {
        case 'select':
          previousStep = 'type'
          break
        case 'options':
          previousStep = 'select'
          break
        case 'exporting':
          previousStep =
            prev.entityType === 'characters' ||
            prev.entityType === 'personas' ||
            prev.entityType === 'chats'
              ? 'options'
              : 'select'
          break
        case 'error':
          previousStep = prev.entityType === 'characters' || prev.entityType === 'personas' || prev.entityType === 'chats' ? 'options' : 'select'
          break
        default:
          return prev
      }

      clientLogger.debug('Moving to previous step', {
        context: 'useExportData',
        currentStep: prev.step,
        previousStep,
      })

      return { ...prev, step: previousStep, error: null }
    })
  }, [])

  const handleExport = useCallback(async () => {
    if (!state.entityType) return

    setState((prev) => ({ ...prev, step: 'exporting', exporting: true, error: null }))

    try {
      clientLogger.debug('Starting export', {
        context: 'useExportData',
        entityType: state.entityType,
        scope: state.scope,
        selectedCount: state.selectedIds.length,
        includeMemories: state.includeMemories,
      })

      const response = await fetch('/api/tools/quilltap-export', {
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

      setState((prev) => ({
        ...prev,
        step: 'complete',
        exporting: false,
      }))

      onSuccess?.()
    } catch (error) {
      const message = getErrorMessage(error)
      clientLogger.error('Failed to export', {
        context: 'useExportData',
        error: message,
      })
      setState((prev) => ({
        ...prev,
        step: 'error',
        exporting: false,
        error: message,
      }))
    }
  }, [state.entityType, state.scope, state.selectedIds, state.includeMemories, onSuccess])

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
