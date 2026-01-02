'use client'

import { useCallback, useMemo } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { getErrorMessage } from '@/lib/error-utils'
import { useDialogStateWithFileInput } from '@/hooks/useDialogState'
import { useWizardState } from '@/hooks/useWizardState'
import type {
  ImportState,
  ImportStep,
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
  const { state, setState, reset, fileInputRef } = useDialogStateWithFileInput({
    isOpen,
    initialState,
    logContext: 'useImportKeys',
  })

  // Wizard step configuration
  const wizard = useWizardState<ImportStep>(
    {
      initialStep: 'file',
      steps: {
        file: { next: ['passphrase'] },
        passphrase: { prev: 'file', next: ['preview'] },
        preview: { prev: 'passphrase', next: ['importing', 'options'] },
        options: { prev: 'preview', next: ['importing'] },
        importing: { next: ['complete', 'error'] },
        complete: { isTerminal: true },
        error: { prev: 'preview', isTerminal: true },
      },
      logContext: 'useImportKeys',
    },
    state.step,
    (step) => setState((prev) => ({ ...prev, step }))
  )

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

        // Use wizard for step navigation
        wizard.goTo('passphrase')
        setState((prev) => ({
          ...prev,
          selectedFile: file,
          fileData: data,
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
    [wizard, setState]
  )

  const setPassphrase = useCallback((value: string) => {
    setState((prev) => ({ ...prev, passphrase: value, error: null }))
  }, [setState])

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

      // Use wizard for step navigation
      wizard.goTo('preview')
      setState((prev) => ({
        ...prev,
        keyPreviews: data.keys,
        signatureValid: data.signatureValid,
        duplicateCount: data.duplicateCount,
      }))
    } catch (error) {
      const message = getErrorMessage(error)
      clientLogger.error('Failed to verify import', {
        context: 'useImportKeys',
        error: message,
      })
      setState((prev) => ({ ...prev, error: message }))
    }
  }, [state.fileData, state.passphrase, wizard, setState])

  const setDuplicateHandling = useCallback((value: DuplicateHandling) => {
    setState((prev) => ({ ...prev, duplicateHandling: value }))
  }, [setState])

  const handleImport = useCallback(async () => {
    if (!state.fileData || !state.passphrase) return

    // Use wizard for step navigation
    wizard.goTo('importing')
    setState((prev) => ({ ...prev, importing: true, error: null }))

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

      wizard.goTo('complete')
      setState((prev) => ({
        ...prev,
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
      wizard.goTo('error')
      setState((prev) => ({
        ...prev,
        importing: false,
        error: message,
      }))
    }
  }, [state.fileData, state.passphrase, state.duplicateHandling, wizard, onSuccess, setState])

  const goBack = useCallback(() => {
    // Handle special state cleanup when going back from passphrase
    if (state.step === 'passphrase') {
      setState((prev) => ({ ...prev, passphrase: '', error: null }))
    } else {
      setState((prev) => ({ ...prev, error: null }))
    }
    // Use wizard for step navigation
    wizard.goBack()
  }, [state.step, wizard, setState])

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
