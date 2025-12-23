'use client'

import { useState, useCallback, useMemo } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'
import { SyncApiKeyDisplay, CreateApiKeyResult } from '../types'

/**
 * Hook for managing sync API keys
 */
export function useSyncApiKeys() {
  const [keys, setKeys] = useState<SyncApiKeyDisplay[]>([])
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Async operation hooks
  const fetchOp = useAsyncOperation<SyncApiKeyDisplay[]>()
  const createOp = useAsyncOperation<CreateApiKeyResult>()
  const deleteOp = useAsyncOperation<void>()

  /**
   * Fetch all sync API keys from the server
   */
  const fetchKeys = useCallback(async () => {
    clientLogger.debug('Fetching sync API keys')
    const result = await fetchOp.execute(async () => {
      const response = await fetchJson<{ keys: SyncApiKeyDisplay[] }>('/api/sync/api-keys')
      if (!response.ok) {
        throw new Error(response.error || 'Failed to fetch sync API keys')
      }
      return response.data?.keys || []
    })
    if (result) {
      setKeys(result)
      clientLogger.debug('Fetched sync API keys', { count: result.length })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // fetchOp.execute is stable

  /**
   * Create a new API key
   */
  const createKey = useCallback(
    async (name: string) => {
      clientLogger.debug('Creating sync API key', { name })

      const result = await createOp.execute(async () => {
        const response = await fetchJson<CreateApiKeyResult>('/api/sync/api-keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        })

        if (!response.ok) {
          throw new Error(response.error || 'Failed to create sync API key')
        }

        if (!response.data) {
          throw new Error('No data returned from server')
        }

        return response.data
      })

      if (result) {
        setKeys(prev => [result.key, ...prev])
        setNewlyCreatedKey(result.plaintextKey)
        setSuccess('API key created successfully. Copy it now - it won\'t be shown again!')
        clientLogger.info('Sync API key created', { keyId: result.key.id })
        // Don't auto-clear success for key creation - user needs to copy the key
        return result
      }

      return null
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [] // createOp.execute is stable
  )

  /**
   * Delete an API key
   */
  const deleteKey = useCallback(
    async (keyId: string) => {
      clientLogger.debug('Deleting sync API key', { keyId })

      const result = await deleteOp.execute(async () => {
        const response = await fetchJson<void>(`/api/sync/api-keys/${keyId}`, {
          method: 'DELETE',
        })

        if (!response.ok) {
          throw new Error(response.error || 'Failed to delete sync API key')
        }
      })

      if (result !== null) {
        setKeys(prev => prev.filter(k => k.id !== keyId))
        setSuccess('API key deleted successfully')
        setDeleteConfirm(null)
        clientLogger.info('Sync API key deleted', { keyId })
        setTimeout(() => setSuccess(null), 3000)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [] // deleteOp.execute is stable
  )

  /**
   * Clear the newly created key (after user has copied it)
   */
  const clearNewlyCreatedKey = useCallback(() => {
    setNewlyCreatedKey(null)
    setSuccess(null)
  }, [])

  /**
   * Clear success message
   */
  const clearSuccess = useCallback(() => {
    setSuccess(null)
  }, [])

  // Memoize the return value
  return useMemo(
    () => ({
      keys,
      newlyCreatedKey,
      success,
      deleteConfirm,
      fetchOp,
      createOp,
      deleteOp,
      fetchKeys,
      createKey,
      deleteKey,
      clearNewlyCreatedKey,
      clearSuccess,
      setDeleteConfirm,
    }),
    [
      keys,
      newlyCreatedKey,
      success,
      deleteConfirm,
      fetchOp,
      createOp,
      deleteOp,
      fetchKeys,
      createKey,
      deleteKey,
      clearNewlyCreatedKey,
      clearSuccess,
    ]
  )
}
