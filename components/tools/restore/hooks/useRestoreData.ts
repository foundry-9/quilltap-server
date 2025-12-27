'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { getErrorMessage } from '@/lib/error-utils'
import type { BackupInfo } from '@/lib/backup/types'
import type {
  RestoreStep,
  RestoreMode,
  RestorePreview,
  RestoreState,
} from '../types'

export function useRestoreData(isOpen: boolean) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<RestoreState>({
    step: 'source',
    selectedFile: null,
    s3Backups: [],
    selectedS3Key: null,
    loadingBackups: false,
    backupsLoaded: false,
    preview: null,
    loadingPreview: false,
    restoreMode: 'import',
    confirmReplace: false,
    restoring: false,
    restoreSummary: null,
    error: null,
  })

  const loadS3Backups = useCallback(async () => {
    setState((prev) => ({ ...prev, loadingBackups: true }))
    try {
      clientLogger.info('Loading S3 backups')
      const response = await fetch('/api/tools/backup/list')
      if (!response.ok) throw new Error('Failed to load backups')
      const data = await response.json()
      setState((prev) => ({
        ...prev,
        s3Backups: data.backups || data || [],
        backupsLoaded: true,
      }))
    } catch (err) {
      const errorMessage = getErrorMessage(err, 'Failed to load backups')
      clientLogger.error('Failed to load S3 backups', { error: errorMessage })
      setState((prev) => ({ ...prev, backupsLoaded: true }))
    } finally {
      setState((prev) => ({ ...prev, loadingBackups: false }))
    }
  }, [])

  // Load S3 backups when dialog opens
  useEffect(() => {
    if (isOpen && state.step === 'source' && !state.backupsLoaded && !state.loadingBackups) {
      loadS3Backups()
    }
  }, [isOpen, state.step, state.backupsLoaded, state.loadingBackups, loadS3Backups])

  // Reset state when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setState((prev) => ({ ...prev, backupsLoaded: false }))
    }
  }, [isOpen])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setState((prev) => ({
      ...prev,
      selectedFile: e.target.files?.[0] || null,
      selectedS3Key: null,
      error: null,
    }))
  }, [])

  const handleS3Select = useCallback((key: string) => {
    setState((prev) => ({
      ...prev,
      selectedS3Key: key,
      selectedFile: null,
      error: null,
    }))
  }, [])

  const fetchPreview = useCallback(async () => {
    setState((prev) => ({ ...prev, loadingPreview: true, error: null }))

    try {
      clientLogger.info('Fetching restore preview', {
        hasFile: !!state.selectedFile,
        hasS3Key: !!state.selectedS3Key,
      })

      const formData = new FormData()
      if (state.selectedFile) {
        formData.append('file', state.selectedFile)
      } else if (state.selectedS3Key) {
        formData.append('s3Key', state.selectedS3Key)
      }

      const previewResponse = await fetch('/api/tools/backup/preview', {
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

      clientLogger.info('Preview loaded successfully', {
        preview: previewData.preview,
      })
    } catch (err) {
      const errorMessage = getErrorMessage(err, 'Failed to preview backup')
      setState((prev) => ({ ...prev, error: errorMessage }))
      clientLogger.error('Failed to fetch preview', { error: errorMessage })
      showErrorToast(errorMessage)
    } finally {
      setState((prev) => ({ ...prev, loadingPreview: false }))
    }
  }, [state.selectedFile, state.selectedS3Key])

  const handleNext = useCallback(async () => {
    if (state.step === 'source') {
      if (!state.selectedFile && !state.selectedS3Key) {
        setState((prev) => ({
          ...prev,
          error: 'Please select a backup source',
        }))
        return
      }
      await fetchPreview()
    } else if (state.step === 'preview') {
      setState((prev) => ({ ...prev, step: 'mode' }))
    }
  }, [state.step, state.selectedFile, state.selectedS3Key, fetchPreview])

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
        clientLogger.info('Starting restore', {
          mode: state.restoreMode,
          hasFile: !!state.selectedFile,
          hasS3Key: !!state.selectedS3Key,
        })

        const formData = new FormData()
        if (state.selectedFile) {
          formData.append('file', state.selectedFile)
        } else if (state.selectedS3Key) {
          formData.append('s3Key', state.selectedS3Key)
        }
        formData.append('mode', state.restoreMode === 'replace' ? 'replace' : 'new-account')

        const response = await fetch('/api/tools/backup/restore', {
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

        clientLogger.info('Restore completed successfully', {
          summary: data.summary,
        })

        showSuccessToast('Backup restored successfully')
      } catch (err) {
        const errorMessage = getErrorMessage(err, 'Failed to restore backup')
        setState((prev) => ({
          ...prev,
          error: errorMessage,
          step: 'mode',
        }))
        clientLogger.error('Restore failed', { error: errorMessage })
        showErrorToast(errorMessage)
      } finally {
        setState((prev) => ({ ...prev, restoring: false }))
      }
    },
    [state.restoreMode, state.confirmReplace, state.selectedFile, state.selectedS3Key]
  )

  const resetDialog = useCallback(() => {
    setState({
      step: 'source',
      selectedFile: null,
      s3Backups: state.s3Backups,
      selectedS3Key: null,
      loadingBackups: false,
      backupsLoaded: state.backupsLoaded,
      preview: null,
      loadingPreview: false,
      restoreMode: 'import',
      confirmReplace: false,
      restoring: false,
      restoreSummary: null,
      error: null,
    })
  }, [state.s3Backups, state.backupsLoaded])

  return {
    state,
    fileInputRef,
    actions: {
      loadS3Backups,
      handleFileSelect,
      handleS3Select,
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
