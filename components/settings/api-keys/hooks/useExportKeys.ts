'use client'

import { useCallback } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { getErrorMessage } from '@/lib/error-utils'
import { useDialogState } from '@/hooks/useDialogState'
import { useWizardState } from '@/hooks/useWizardState'
import type { ExportState, ExportFile, ExportStep } from '../types'

const MIN_PASSPHRASE_LENGTH = 8

interface UseExportKeysOptions {
  isOpen: boolean
  onSuccess?: () => void
}

interface UseExportKeysReturn {
  state: ExportState
  isValid: boolean
  passphraseError: string | null
  actions: {
    setPassphrase: (value: string) => void
    setPassphraseConfirm: (value: string) => void
    handleExport: () => Promise<void>
    reset: () => void
  }
}

const initialState: ExportState = {
  step: 'passphrase',
  passphrase: '',
  passphraseConfirm: '',
  exporting: false,
  error: null,
}

export function useExportKeys({
  isOpen,
  onSuccess,
}: UseExportKeysOptions): UseExportKeysReturn {
  const { state, setState, reset } = useDialogState({
    isOpen,
    initialState,
    logContext: 'useExportKeys',
  })

  // Wizard step configuration
  const wizard = useWizardState<ExportStep>(
    {
      initialStep: 'passphrase',
      steps: {
        passphrase: { next: ['exporting'] },
        exporting: { next: ['complete', 'error'] },
        complete: { isTerminal: true },
        error: { prev: 'passphrase', isTerminal: true },
      },
      logContext: 'useExportKeys',
    },
    state.step,
    (step) => setState((prev) => ({ ...prev, step }))
  )

  // Validate passphrase
  const passphraseError = (() => {
    if (!state.passphrase) return null
    if (state.passphrase.length < MIN_PASSPHRASE_LENGTH) {
      return `Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`
    }
    if (state.passphraseConfirm && state.passphrase !== state.passphraseConfirm) {
      return 'Passphrases do not match'
    }
    return null
  })()

  const isValid =
    state.passphrase.length >= MIN_PASSPHRASE_LENGTH &&
    state.passphrase === state.passphraseConfirm

  const setPassphrase = useCallback((value: string) => {
    setState((prev) => ({ ...prev, passphrase: value, error: null }))
  }, [])

  const setPassphraseConfirm = useCallback((value: string) => {
    setState((prev) => ({ ...prev, passphraseConfirm: value, error: null }))
  }, [])

  const handleExport = useCallback(async () => {
    if (!isValid) return

    // Use wizard for step navigation, setState for other state
    wizard.goTo('exporting')
    setState((prev) => ({ ...prev, exporting: true, error: null }))

    try {
      clientLogger.debug('Starting API key export', { context: 'useExportKeys' })

      const response = await fetch('/api/keys/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase: state.passphrase }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to export API keys')
      }

      const exportFile: ExportFile = await response.json()

      // Trigger file download
      const blob = new Blob([JSON.stringify(exportFile, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `quilltap-api-keys-${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      clientLogger.info('API keys exported successfully', {
        context: 'useExportKeys',
        keyCount: exportFile.keyCount,
      })

      wizard.goTo('complete')
      setState((prev) => ({ ...prev, exporting: false }))
      onSuccess?.()
    } catch (error) {
      const message = getErrorMessage(error)
      clientLogger.error('Failed to export API keys', { context: 'useExportKeys', error: message })
      wizard.goTo('error')
      setState((prev) => ({ ...prev, exporting: false, error: message }))
    }
  }, [isValid, state.passphrase, wizard, onSuccess])

  return {
    state,
    isValid,
    passphraseError,
    actions: {
      setPassphrase,
      setPassphraseConfirm,
      handleExport,
      reset,
    },
  }
}
