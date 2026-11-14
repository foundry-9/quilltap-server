'use client'

/**
 * The actions an API key row offers — test and delete-with-confirm — stated
 * once for both surfaces that list keys: the API Keys card (*By kind*) and the
 * per-provider cards (*By provider*). State is per surface: each list owns its
 * own confirm target and test results.
 *
 * @module components/settings/api-keys/hooks/useApiKeyActions
 */

import { useCallback, useState } from 'react'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'

export interface ApiKeyActions {
  testingKeyId: string | null
  testResults: Record<string, string>
  deleteConfirmId: string | null
  isDeleting: boolean
  deleteError: string | null
  setDeleteConfirmId: (id: string | null) => void
  handleTest: (id: string) => Promise<void>
  handleDeleteConfirm: () => Promise<void>
}

/**
 * @param onChanged called after a key is deleted, to refresh whichever list shows it.
 */
export function useApiKeyActions(onChanged: () => unknown): ApiKeyActions {
  const [testingKeyId, setTestingKeyId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, string>>({})
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const deleteKey = useAsyncOperation<void>()
  const testKey = useAsyncOperation<{ valid: boolean; error?: string }>()

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteConfirmId) return

    const result = await deleteKey.execute(async () => {
      const response = await fetchJson<void>(`/api/v1/api-keys/${deleteConfirmId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error(response.error || 'Failed to delete API key')
      }
    })

    if (result !== null) {
      setDeleteConfirmId(null)
      await onChanged()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deleteKey is a fresh object each render, but its execute is a stable useCallback
  }, [deleteConfirmId, onChanged]) // deleteKey.execute is stable

  const handleTest = useCallback(async (id: string) => {
    setTestingKeyId(id)
    setTestResults({})

    const result = await testKey.execute(async () => {
      const response = await fetchJson<{ valid: boolean; error?: string }>(
        `/api/v1/api-keys/${id}?action=test`,
        { method: 'POST' }
      )

      if (!response.ok) {
        throw new Error(response.error || 'Failed to test API key')
      }

      return response.data || { valid: false }
    })

    if (result) {
      if (result.valid) {
        setTestResults({ [id]: '✓ Key is valid' })
      } else {
        setTestResults({ [id]: `✗ ${result.error || 'Key is invalid'}` })
      }
    } else {
      setTestResults({ [id]: 'Connection failed' })
      console.error('API key test connection failed', { id })
    }

    setTestingKeyId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- testKey is a fresh object each render, but its execute is a stable useCallback
  }, []) // testKey.execute is stable

  return {
    testingKeyId,
    testResults,
    deleteConfirmId,
    isDeleting: deleteKey.loading,
    deleteError: deleteKey.error,
    setDeleteConfirmId,
    handleTest,
    handleDeleteConfirm,
  }
}
