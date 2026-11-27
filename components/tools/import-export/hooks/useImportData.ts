'use client'

import { useCallback } from 'react'
import { getErrorMessage } from '@/lib/error-utils'
import { useDialogStateWithFileInput } from '@/hooks/useDialogState'
import type { ImportState, ImportStep, ImportPreviewUI } from '../types'
import { previewHasMemories } from '../utils'
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
      // Peek the first 256 KB — enough to hold any envelope even with large
      // selectedIds lists, and cheap to read. If we don't see an NDJSON
      // marker in that prefix, fall through to the legacy monolithic path.
      const PEEK_BYTES = 256 * 1024
      const prefix = await file.slice(0, PEEK_BYTES).text()

      if (/"format"\s*:\s*"qtap-ndjson"/.test(prefix)) {
        // Streaming NDJSON — parse just the envelope line, never the whole
        // file. The server re-reads the upload as a stream, so we don't need
        // `data` populated client-side.
        const firstNewline = prefix.indexOf('\n')
        if (firstNewline < 0) {
          throw new Error('Invalid export file format. NDJSON envelope line is missing a newline.')
        }
        const envelopeLine = prefix.slice(0, firstNewline)
        const envelope = JSON.parse(envelopeLine) as {
          format?: string
          version?: number
          manifest?: QuilltapExport['manifest']
        }
        if (envelope.format !== 'qtap-ndjson' || !envelope.manifest) {
          throw new Error('Invalid NDJSON envelope in export file.')
        }
        return {
          manifest: envelope.manifest,
          data: {} as QuilltapExport['data'],
        }
      }

      // Legacy monolithic JSON — only path that has to load the whole file
      // into a single client-side string. Files that blow the browser's
      // string ceiling here were already unusable in the pre-NDJSON version.
      const text = await file.text()
      const data = JSON.parse(text) as QuilltapExport

      if (!data.manifest || data.manifest.format !== 'quilltap-export') {
        throw new Error('Invalid export file format. Please select a valid Quilltap export file (.qtap).')
      }

      return data
    } catch (error) {
      const message = getErrorMessage(error)
      throw new Error(
        message.includes('Invalid') || message.includes('envelope')
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
    async (file: File) => {
      setState((prev) => ({ ...prev, loadingPreview: true, error: null }))

      try {
        // Send the original file as FormData rather than re-serializing large JSON
        const formData = new FormData()
        formData.append('file', file)
        const response = await fetch('/api/v1/system/tools?action=import-preview', {
          method: 'POST',
          body: formData,
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to load preview')
        }

        const preview: ImportPreviewUI = await response.json()

        // Auto-enable memory import when the export contains memories
        const hasMemories = previewHasMemories(preview)

        setState((prev) => ({
          ...prev,
          preview,
          loadingPreview: false,
          ...(hasMemories && { importMemories: true }),
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

    // The options step's forward action is handleImport, not Next.
    switch (currentStep) {
      case 'file':
        nextStep = 'preview'
        break
      case 'preview':
        nextStep = 'options'
        break
      default:
        return
    }

    setState((prev) => ({ ...prev, step: nextStep }))

    // Load preview when moving to preview step
    // (A file is chosen and parsed together, so exportData implies selectedFile.)
    if (currentStep === 'file' && state.selectedFile) {
      await loadPreview(state.selectedFile)
    }
  }, [state.step, state.exportData, state.selectedFile, loadPreview, setState])

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
    // A file is chosen and parsed together, so exportData implies selectedFile.
    if (!state.exportData || !state.selectedFile) return

    setState((prev) => ({ ...prev, importing: true, error: null }))

    try {
      // Send the original file as FormData rather than re-serializing large JSON
      const formData = new FormData()
      formData.append('file', state.selectedFile)
      formData.append('options', JSON.stringify({
        selectedIds: state.selectedEntityIds,
        conflictStrategy: state.conflictStrategy,
        importMemories: state.importMemories,
      }))
      const response = await fetch('/api/v1/system/tools?action=import-execute', {
        method: 'POST',
        body: formData,
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
  }, [state.exportData, state.selectedFile, state.conflictStrategy, state.importMemories, state.selectedEntityIds, onSuccess, setState])

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
