'use client'

import { useCallback } from 'react'
import { getErrorMessage } from '@/lib/error-utils'
import { useDialogStateWithFileInput } from '@/hooks/useDialogState'
import type { ImportState, ImportStep } from '../types'
import type { QuilltapExport, ConflictStrategy } from '@/lib/export/types'

interface UseImportDataOptions {
  isOpen: boolean
  onSuccess?: () => void
}

interface UseImportDataReturn {
  state: ImportState
  fileInputRef: React.RefObject<HTMLInputElement | null>
  actions: {
    handleFileSelect: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>
    handleFileDrop: (event: React.DragEvent<HTMLDivElement>) => Promise<void>
    setConflictStrategy: (strategy: ConflictStrategy) => void
    setImportMemories: (value: boolean) => void
    toggleEntitySelection: (type: string, id: string) => void
    handleNext: () => Promise<void>
    handleBack: () => void
    handleImport: () => Promise<void>
    reset: () => void
  }
}

const initialState: ImportState = {
  step: 'file',
  selectedFile: null,
  exportData: null,
  preview: null,
  loadingPreview: false,
  conflictStrategy: 'skip',
  importMemories: false,
  selectedEntityIds: {},
  importing: false,
  importResult: null,
  error: null,
}

export function useImportData({
  isOpen,
  onSuccess,
}: UseImportDataOptions): UseImportDataReturn {
  const { state, setState, reset, fileInputRef } = useDialogStateWithFileInput({
    isOpen,
    initialState,
  })

  const parseExportFile = useCallback(async (file: File): Promise<QuilltapExport> => {
    try {
      const text = await file.text()
      const data = JSON.parse(text) as QuilltapExport

      // Validate basic structure
      if (!data.manifest || data.manifest.format !== 'quilltap-export') {
        throw new Error('Invalid export file format. Please select a valid Quilltap export file (.qtap).')
      }

      return data
    } catch (error) {
      const message = getErrorMessage(error)
      throw new Error(
        message.includes('Invalid export file format')
          ? message
          : 'Failed to parse file. Please ensure it is a valid Quilltap export file.',
      )
    }
  }, [])

  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

      try {
        const exportData = await parseExportFile(file)

        setState((prev) => ({
          ...prev,
          selectedFile: file,
          exportData,
          error: null,
        }))
      } catch (error) {
        const message = getErrorMessage(error)
        console.error('Failed to parse import file', {
          context: 'useImportData',
          error: message,
        })
        setState((prev) => ({
          ...prev,
          error: message,
        }))
      }
    },
    [parseExportFile, setState],
  )

  const handleFileDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()

      const files = event.dataTransfer.files
      if (!files.length) return

      const file = files[0]

      try {
        const exportData = await parseExportFile(file)

        setState((prev) => ({
          ...prev,
          selectedFile: file,
          exportData,
          error: null,
        }))
      } catch (error) {
        const message = getErrorMessage(error)
        console.error('Failed to parse dropped file', {
          context: 'useImportData',
          error: message,
        })
        setState((prev) => ({
          ...prev,
          error: message,
        }))
      }
    },
    [parseExportFile, setState],
  )

  const setConflictStrategy = useCallback((strategy: 'skip' | 'overwrite' | 'duplicate') => {
    setState((prev) => ({ ...prev, conflictStrategy: strategy as ConflictStrategy }))
  }, [setState])

  const setImportMemories = useCallback((value: boolean) => {
    setState((prev) => ({ ...prev, importMemories: value }))
  }, [setState])

  const toggleEntitySelection = useCallback((type: string, id: string) => {
    setState((prev) => {
      const selectedIds = prev.selectedEntityIds[type] || []
      const newSelectedIds = selectedIds.includes(id)
        ? selectedIds.filter((selectedId) => selectedId !== id)
        : [...selectedIds, id]

      return {
        ...prev,
        selectedEntityIds: {
          ...prev.selectedEntityIds,
          [type]: newSelectedIds,
        },
      }
    })
  }, [setState])

  const loadPreview = useCallback(
    async (exportData: QuilltapExport) => {
      setState((prev) => ({ ...prev, loadingPreview: true, error: null }))

      try {
        const response = await fetch('/api/v1/system/tools?action=import-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ exportData }),
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to load preview')
        }

        const preview = await response.json()

        setState((prev) => ({
          ...prev,
          preview,
          loadingPreview: false,
        }))
      } catch (error) {
        const message = getErrorMessage(error)
        console.error('Failed to load preview', {
          context: 'useImportData',
          error: message,
        })
        setState((prev) => ({
          ...prev,
          loadingPreview: false,
          error: message,
        }))
      }
    },
    [setState],
  )

  const handleNext = useCallback(async () => {
    // Check if we can proceed before setting state
    if (state.step === 'file' && !state.exportData) {
      return
    }

    const currentStep = state.step
    let nextStep: ImportStep = currentStep

    switch (currentStep) {
      case 'file':
        nextStep = 'preview'
        break
      case 'preview':
        nextStep = 'options'
        break
      case 'options':
        nextStep = 'importing'
        break
      default:
        return
    }

    setState((prev) => ({ ...prev, step: nextStep }))

    // Load preview when moving to preview step
    if (currentStep === 'file' && state.exportData) {
      await loadPreview(state.exportData)
    }
  }, [state.step, state.exportData, loadPreview, setState])

  const handleBack = useCallback(() => {
    setState((prev) => {
      let previousStep: ImportStep = prev.step

      switch (prev.step) {
        case 'preview':
          previousStep = 'file'
          break
        case 'options':
          previousStep = 'preview'
          break
        case 'error':
          previousStep = 'options'
          break
        default:
          return prev
      }

      return { ...prev, step: previousStep, error: null }
    })
  }, [setState])

  const handleImport = useCallback(async () => {
    if (!state.exportData) return

    setState((prev) => ({ ...prev, importing: true, error: null }))

    try {
      const response = await fetch('/api/v1/system/tools?action=import-execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exportData: state.exportData,
          options: {
            selectedIds: state.selectedEntityIds,
            conflictStrategy: state.conflictStrategy,
            importMemories: state.importMemories,
          },
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to import data')
      }

      const result = await response.json()

      setState((prev) => ({
        ...prev,
        step: 'complete',
        importing: false,
        importResult: result,
      }))

      onSuccess?.()
    } catch (error) {
      const message = getErrorMessage(error)
      console.error('Failed to import data', {
        context: 'useImportData',
        error: message,
      })
      setState((prev) => ({
        ...prev,
        step: 'error',
        importing: false,
        error: message,
      }))
    }
  }, [state.exportData, state.conflictStrategy, state.importMemories, state.selectedEntityIds, onSuccess, setState])

  return {
    state,
    fileInputRef,
    actions: {
      handleFileSelect,
      handleFileDrop,
      setConflictStrategy,
      setImportMemories,
      toggleEntitySelection,
      handleNext,
      handleBack,
      handleImport,
      reset,
    },
  }
}
