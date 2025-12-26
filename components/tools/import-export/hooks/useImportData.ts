'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { getErrorMessage } from '@/lib/error-utils'
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
  const [state, setState] = useState<ImportState>(initialState)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (!isOpen) {
      setState(initialState)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }, [isOpen])

  // Log when dialog opens
  useEffect(() => {
    if (isOpen) {
      clientLogger.debug('Import dialog opened', {
        context: 'useImportData',
      })
    }
  }, [isOpen])

  const parseExportFile = useCallback(async (file: File): Promise<QuilltapExport> => {
    try {
      const text = await file.text()
      const data = JSON.parse(text) as QuilltapExport

      // Validate basic structure
      if (!data.manifest || data.manifest.format !== 'quilltap-export') {
        throw new Error('Invalid export file format. Please select a valid Quilltap export file (.qtap).')
      }

      clientLogger.debug('Export file parsed successfully', {
        context: 'useImportData',
        fileName: file.name,
        exportType: data.manifest.exportType,
      })

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

      clientLogger.debug('File selected for import', {
        context: 'useImportData',
        fileName: file.name,
        fileSize: file.size,
      })

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
        clientLogger.error('Failed to parse import file', {
          context: 'useImportData',
          error: message,
        })
        setState((prev) => ({
          ...prev,
          error: message,
        }))
      }
    },
    [parseExportFile],
  )

  const handleFileDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()

      const files = event.dataTransfer.files
      if (!files.length) return

      const file = files[0]
      clientLogger.debug('File dropped for import', {
        context: 'useImportData',
        fileName: file.name,
        fileSize: file.size,
      })

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
        clientLogger.error('Failed to parse dropped file', {
          context: 'useImportData',
          error: message,
        })
        setState((prev) => ({
          ...prev,
          error: message,
        }))
      }
    },
    [parseExportFile],
  )

  const setConflictStrategy = useCallback((strategy: 'skip' | 'overwrite' | 'duplicate') => {
    clientLogger.debug('Conflict strategy changed', {
      context: 'useImportData',
      strategy,
    })
    setState((prev) => ({ ...prev, conflictStrategy: strategy as ConflictStrategy }))
  }, [])

  const setImportMemories = useCallback((value: boolean) => {
    clientLogger.debug('Import memories toggled', {
      context: 'useImportData',
      importMemories: value,
    })
    setState((prev) => ({ ...prev, importMemories: value }))
  }, [])

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
  }, [])

  const loadPreview = useCallback(
    async (exportData: QuilltapExport) => {
      setState((prev) => ({ ...prev, loadingPreview: true, error: null }))

      try {
        clientLogger.debug('Loading import preview', {
          context: 'useImportData',
          exportType: exportData.manifest.exportType,
        })

        const response = await fetch('/api/tools/quilltap-import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ exportData }),
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to load preview')
        }

        const preview = await response.json()

        clientLogger.info('Import preview loaded', {
          context: 'useImportData',
          entityTypes: Object.keys(preview.entities || {}),
        })

        setState((prev) => ({
          ...prev,
          preview,
          loadingPreview: false,
        }))
      } catch (error) {
        const message = getErrorMessage(error)
        clientLogger.error('Failed to load preview', {
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
    [],
  )

  const handleNext = useCallback(async () => {
    // Check if we can proceed before setting state
    if (state.step === 'file' && !state.exportData) {
      clientLogger.warn('Cannot proceed without file selected', {
        context: 'useImportData',
      })
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

    clientLogger.debug('Moving to next step', {
      context: 'useImportData',
      currentStep,
      nextStep,
    })

    setState((prev) => ({ ...prev, step: nextStep }))

    // Load preview when moving to preview step
    if (currentStep === 'file' && state.exportData) {
      await loadPreview(state.exportData)
    }
  }, [state.step, state.exportData, loadPreview])

  const handleBack = useCallback(() => {
    clientLogger.debug('Moving to previous step', {
      context: 'useImportData',
    })

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
  }, [])

  const handleImport = useCallback(async () => {
    if (!state.exportData) return

    setState((prev) => ({ ...prev, importing: true, error: null }))

    try {
      clientLogger.debug('Starting import', {
        context: 'useImportData',
        conflictStrategy: state.conflictStrategy,
        importMemories: state.importMemories,
      })

      const response = await fetch('/api/tools/quilltap-import/execute', {
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

      clientLogger.info('Import completed successfully', {
        context: 'useImportData',
        imported: result.imported,
        skipped: result.skipped,
      })

      setState((prev) => ({
        ...prev,
        step: 'complete',
        importing: false,
        importResult: result,
      }))

      onSuccess?.()
    } catch (error) {
      const message = getErrorMessage(error)
      clientLogger.error('Failed to import data', {
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
  }, [state.exportData, state.conflictStrategy, state.importMemories, state.selectedEntityIds, onSuccess])

  const reset = useCallback(() => {
    clientLogger.debug('Resetting import state', { context: 'useImportData' })
    setState(initialState)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [])

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
