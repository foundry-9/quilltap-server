'use client'

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { getErrorMessage } from '@/lib/error-utils'
import type {
  ImportState,
  ExportFile,
  PreviewResponse,
  ImportResult,
  DuplicateHandling,
} from '../types'

interface UseImportKeysOptions {
  isOpen: boolean
  onSuccess?: () => void
}

interface UseImportKeysReturn {
  state: ImportState
  fileInputRef: React.RefObject<HTMLInputElement | null>
  actions: {
    handleFileSelect: (event: React.ChangeEvent<HTMLInputElement>) => void
    setPassphrase: (value: string) => void
    handleVerify: () => Promise<void>
    setDuplicateHandling: (value: DuplicateHandling) => void
    handleImport: () => Promise<void>
    goBack: () => void
    reset: () => void
  }
}

const initialState: ImportState = {
  step: 'file',
  selectedFile: null,
  fileData: null,
  passphrase: '',
  keyPreviews: [],
  signatureValid: true,
  duplicateCount: 0,
  duplicateHandling: 'skip',
  importing: false,
  importResult: null,
  error: null,
}

export function useImportKeys({
  isOpen,
  onSuccess,
}: UseImportKeysOptions): UseImportKeysReturn {
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
      clientLogger.debug('Import keys dialog opened', {
        context: 'useImportKeys',
      })
    }
  }, [isOpen])

  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

      clientLogger.debug('File selected for import', {
        context: 'useImportKeys',
        fileName: file.name,
        fileSize: file.size,
      })

      try {
        const text = await file.text()
        const data = JSON.parse(text) as ExportFile

        // Basic validation
        if (data.format !== 'quilltap-apikeys') {
          throw new Error('Invalid file format. Please select a Quilltap API keys export file.')
        }

        setState((prev) => ({
          ...prev,
          selectedFile: file,
          fileData: data,
          step: 'passphrase',
          error: null,
        }))
      } catch (error) {
        const message = getErrorMessage(error)
        clientLogger.error('Failed to parse import file', {
          context: 'useImportKeys',
          error: message,
        })
        setState((prev) => ({
          ...prev,
          error: message.includes('Invalid file format')
            ? message
            : 'Invalid file. Please select a valid Quilltap API keys export file.',
        }))
      }
    },
    []
  )

  const setPassphrase = useCallback((value: string) => {
    setState((prev) => ({ ...prev, passphrase: value, error: null }))
  }, [])

  const handleVerify = useCallback(async () => {
    if (!state.fileData || !state.passphrase) return

    setState((prev) => ({ ...prev, error: null }))

    try {
      clientLogger.debug('Verifying import passphrase', { context: 'useImportKeys' })

      const response = await fetch('/api/keys/import/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file: state.fileData,
          passphrase: state.passphrase,
        }),
      })

      const data: PreviewResponse = await response.json()

      if (!data.valid) {
        throw new Error(data.error || 'Invalid passphrase or corrupted file')
      }

      clientLogger.info('Import preview successful', {
        context: 'useImportKeys',
        keyCount: data.keyCount,
        duplicateCount: data.duplicateCount,
        signatureValid: data.signatureValid,
      })

      setState((prev) => ({
        ...prev,
        keyPreviews: data.keys,
        signatureValid: data.signatureValid,
        duplicateCount: data.duplicateCount,
        step: 'preview',
      }))
    } catch (error) {
      const message = getErrorMessage(error)
      clientLogger.error('Failed to verify import', {
        context: 'useImportKeys',
        error: message,
      })
      setState((prev) => ({ ...prev, error: message }))
    }
  }, [state.fileData, state.passphrase])

  const setDuplicateHandling = useCallback((value: DuplicateHandling) => {
    setState((prev) => ({ ...prev, duplicateHandling: value }))
  }, [])

  const handleImport = useCallback(async () => {
    if (!state.fileData || !state.passphrase) return

    setState((prev) => ({ ...prev, step: 'importing', importing: true, error: null }))

    try {
      clientLogger.debug('Starting API key import', {
        context: 'useImportKeys',
        duplicateHandling: state.duplicateHandling,
      })

      const response = await fetch('/api/keys/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file: state.fileData,
          passphrase: state.passphrase,
          duplicateHandling: state.duplicateHandling,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to import API keys')
      }

      const result: ImportResult = await response.json()

      clientLogger.info('API keys imported successfully', {
        context: 'useImportKeys',
        imported: result.imported,
        skipped: result.skipped,
        replaced: result.replaced,
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
      clientLogger.error('Failed to import API keys', {
        context: 'useImportKeys',
        error: message,
      })
      setState((prev) => ({
        ...prev,
        step: 'error',
        importing: false,
        error: message,
      }))
    }
  }, [state.fileData, state.passphrase, state.duplicateHandling, onSuccess])

  const goBack = useCallback(() => {
    setState((prev) => {
      switch (prev.step) {
        case 'passphrase':
          return { ...prev, step: 'file', passphrase: '', error: null }
        case 'preview':
          return { ...prev, step: 'passphrase', error: null }
        case 'options':
          return { ...prev, step: 'preview', error: null }
        case 'error':
          return { ...prev, step: 'preview', error: null }
        default:
          return prev
      }
    })
  }, [])

  const reset = useCallback(() => {
    setState(initialState)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [])

  // Memoize actions to prevent unnecessary re-renders and effect re-runs
  const actions = useMemo(
    () => ({
      handleFileSelect,
      setPassphrase,
      handleVerify,
      setDuplicateHandling,
      handleImport,
      goBack,
      reset,
    }),
    [
      handleFileSelect,
      setPassphrase,
      handleVerify,
      setDuplicateHandling,
      handleImport,
      goBack,
      reset,
    ]
  )

  return {
    state,
    fileInputRef,
    actions,
  }
}
