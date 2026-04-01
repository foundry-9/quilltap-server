'use client'

import { useState, useRef, useCallback } from 'react'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { getErrorMessage } from '@/lib/error-utils'
import type {
  RestoreStep,
  RestoreMode,
  RestoreState,
} from '../types'

export function useRestoreData(isOpen: boolean) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<RestoreState>({
    step: 'source',
    selectedFile: null,
    preview: null,
    loadingPreview: false,
    restoreMode: 'import',
    confirmReplace: false,
    restoring: false,
    restoreSummary: null,
    error: null,
  })

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setState((prev) => ({
      ...prev,
      selectedFile: e.target.files?.[0] || null,
      error: null,
    }))
  }, [])

  const fetchPreview = useCallback(async () => {
    if (!state.selectedFile) return

    setState((prev) => ({ ...prev, loadingPreview: true, error: null }))

    try {
      const formData = new FormData()
      formData.append('file', state.selectedFile)

      const previewResponse = await fetch('/api/v1/system/restore?action=preview', {
        method: 'POST',
        body: formData,
      })

      if (!previewResponse.ok) {
        const data = await previewResponse.json()
        throw new Error(data.error || 'Failed to preview backup')
      }

      const previewData = await previewResponse.json()
      setState((prev) => ({
        ...prev,
        preview: previewData.preview,
        step: 'preview',
      }))
    } catch (err) {
      const errorMessage = getErrorMessage(err, 'Failed to preview backup')
      setState((prev) => ({ ...prev, error: errorMessage }))
      console.error('Failed to fetch preview', { error: errorMessage })
      showErrorToast(errorMessage)
    } finally {
      setState((prev) => ({ ...prev, loadingPreview: false }))
    }
  }, [state.selectedFile])

  const handleNext = useCallback(async () => {
    if (state.step === 'source') {
      if (!state.selectedFile) {
        setState((prev) => ({
          ...prev,
          error: 'Please select a backup file',
        }))
        return
      }
      await fetchPreview()
    } else if (state.step === 'preview') {
      setState((prev) => ({ ...prev, step: 'mode' }))
    }
  }, [state.step, state.selectedFile, fetchPreview])

  const handleBack = useCallback(() => {
    if (state.step === 'preview') {
      setState((prev) => ({
        ...prev,
        step: 'source',
        preview: null,
      }))
    } else if (state.step === 'mode') {
      setState((prev) => ({ ...prev, step: 'preview' }))
    } else if (state.step === 'progress') {
      setState((prev) => ({
        ...prev,
        step: 'mode',
        restoreSummary: null,
      }))
    }
  }, [state.step])

  const handleStartRestore = useCallback(
    async () => {
      if (!state.selectedFile) return

      if (state.restoreMode === 'replace' && !state.confirmReplace) {
        setState((prev) => ({
          ...prev,
          error: 'Please confirm that you want to delete your existing data',
        }))
        return
      }

      setState((prev) => ({
        ...prev,
        restoring: true,
        error: null,
        step: 'progress',
      }))

      try {
        const formData = new FormData()
        formData.append('file', state.selectedFile)
        formData.append('mode', state.restoreMode === 'replace' ? 'replace' : 'new-account')

        const response = await fetch('/api/v1/system/restore', {
          method: 'POST',
          body: formData,
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to restore backup')
        }

        const data = await response.json()
        setState((prev) => ({
          ...prev,
          restoreSummary: data.summary,
        }))

        showSuccessToast('Backup restored successfully')
      } catch (err) {
        const errorMessage = getErrorMessage(err, 'Failed to restore backup')
        setState((prev) => ({
          ...prev,
          error: errorMessage,
          step: 'mode',
        }))
        console.error('Restore failed', { error: errorMessage })
        showErrorToast(errorMessage)
      } finally {
        setState((prev) => ({ ...prev, restoring: false }))
      }
    },
    [state.restoreMode, state.confirmReplace, state.selectedFile]
  )

  const resetDialog = useCallback(() => {
    setState({
      step: 'source',
      selectedFile: null,
      preview: null,
      loadingPreview: false,
      restoreMode: 'import',
      confirmReplace: false,
      restoring: false,
      restoreSummary: null,
      error: null,
    })
  }, [])

  return {
    state,
    fileInputRef,
    actions: {
      handleFileSelect,
      handleNext,
      handleBack,
      fetchPreview,
      handleStartRestore,
      resetDialog,
      setStep: (step: RestoreStep) => setState((prev) => ({ ...prev, step })),
      setRestoreMode: (mode: RestoreMode) =>
        setState((prev) => ({ ...prev, restoreMode: mode, confirmReplace: false })),
      setConfirmReplace: (confirm: boolean) =>
        setState((prev) => ({ ...prev, confirmReplace: confirm })),
    },
  }
}
