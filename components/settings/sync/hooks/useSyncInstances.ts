'use client'

import { useState, useCallback, useMemo } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'
import { SyncInstanceDisplay, SyncFormData } from '../types'

/**
 * Helper to retry a fetch operation on transient errors
 */
async function fetchWithRetry<T>(
  fetchFn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fetchFn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // Only retry on server errors (500) or "Internal server error"
      const isRetryable = lastError.message.toLowerCase().includes('internal server error') ||
                          lastError.message.includes('500') ||
                          lastError.message.includes('network') ||
                          lastError.message.includes('fetch')

      if (!isRetryable || attempt === maxRetries) {
        throw lastError
      }

      clientLogger.debug('Retrying fetch after transient error', {
        attempt,
        maxRetries,
        error: lastError.message,
        delayMs,
      })

      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }

  throw lastError || new Error('Fetch failed after retries')
}

/**
 * Connection test result from the API
 */
interface ConnectionTestResult {
  success: boolean
  error?: string
  versionInfo?: {
    schemaVersion: string
    appVersion: string
  }
}

/**
 * Hook for managing sync instances data and operations
 */
export function useSyncInstances() {
  const [instances, setInstances] = useState<SyncInstanceDisplay[]>([])
  const [success, setSuccess] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Async operation hooks
  const fetchOp = useAsyncOperation<SyncInstanceDisplay[]>()
  const saveOp = useAsyncOperation<SyncInstanceDisplay>()
  const deleteOp = useAsyncOperation<void>()
  const testOp = useAsyncOperation<ConnectionTestResult>()

  /**
   * Fetch all sync instances from the server
   * Uses retry logic to handle transient connection errors during startup
   * Note: Empty dependency array since fetchOp.execute is stable
   */
  const fetchInstances = useCallback(async () => {
    clientLogger.debug('Fetching sync instances')
    const result = await fetchOp.execute(async () => {
      return fetchWithRetry(async () => {
        const response = await fetchJson<{ instances: SyncInstanceDisplay[] }>('/api/sync/instances')
        clientLogger.debug('Sync instances response', {
          ok: response.ok,
          status: response.status,
          hasData: !!response.data,
          error: response.error || undefined,
        })
        if (!response.ok) {
          throw new Error(response.error || 'Failed to fetch sync instances')
        }
        return response.data?.instances || []
      })
    })
    if (result) {
      setInstances(result)
      clientLogger.debug('Fetched sync instances', { count: result.length })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // fetchOp.execute is stable (empty deps in useAsyncOperation)

  /**
   * Create a new sync instance
   * Note: Empty dependency array since saveOp.execute is stable
   */
  const createInstance = useCallback(
    async (formData: SyncFormData) => {
      clientLogger.debug('Creating sync instance', {
        instanceName: formData.name,
      })

      const result = await saveOp.execute(async () => {
        const response = await fetchJson<SyncInstanceDisplay>('/api/sync/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        })

        if (!response.ok) {
          throw new Error(response.error || 'Failed to create sync instance')
        }

        if (!response.data) {
          throw new Error('No data returned from server')
        }

        return response.data
      })

      if (result) {
        setInstances(prev => [...prev, result])
        setSuccess('Sync instance created successfully')
        clientLogger.info('Sync instance created', { instanceId: result.id })
        setTimeout(() => setSuccess(null), 3000)
        return result
      }

      return null
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [] // saveOp.execute is stable (empty deps in useAsyncOperation)
  )

  /**
   * Update an existing sync instance
   * Note: Empty dependency array since saveOp.execute is stable
   */
  const updateInstance = useCallback(
    async (id: string, formData: Partial<Omit<SyncFormData, 'url'>>) => {
      clientLogger.debug('Updating sync instance', {
        instanceId: id,
        hasApiKey: !!formData.apiKey,
      })

      const result = await saveOp.execute(async () => {
        const response = await fetchJson<SyncInstanceDisplay>(`/api/sync/instances/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        })

        if (!response.ok) {
          throw new Error(response.error || 'Failed to update sync instance')
        }

        if (!response.data) {
          throw new Error('No data returned from server')
        }

        return response.data
      })

      if (result) {
        setInstances(prev => prev.map(i => (i.id === result.id ? result : i)))
        setSuccess('Sync instance updated successfully')
        clientLogger.info('Sync instance updated', { instanceId: result.id })
        setTimeout(() => setSuccess(null), 3000)
        return result
      }

      return null
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [] // saveOp.execute is stable (empty deps in useAsyncOperation)
  )

  /**
   * Delete a sync instance
   * Note: Empty dependency array since deleteOp.execute is stable
   */
  const deleteInstance = useCallback(
    async (instanceId: string) => {
      clientLogger.debug('Deleting sync instance', { instanceId })

      const result = await deleteOp.execute(async () => {
        const response = await fetchJson<void>(`/api/sync/instances/${instanceId}`, {
          method: 'DELETE',
        })

        if (!response.ok) {
          throw new Error(response.error || 'Failed to delete sync instance')
        }
      })

      if (result !== null) {
        setInstances(prev => prev.filter(i => i.id !== instanceId))
        setSuccess('Sync instance deleted successfully')
        setDeleteConfirm(null)
        clientLogger.info('Sync instance deleted', { instanceId })
        setTimeout(() => setSuccess(null), 3000)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [] // deleteOp.execute is stable (empty deps in useAsyncOperation)
  )

  /**
   * Test connection to a sync instance
   * Note: Empty dependency array since testOp.execute is stable
   */
  const testConnection = useCallback(
    async (instanceId: string) => {
      clientLogger.debug('Testing connection to sync instance', { instanceId })

      const result = await testOp.execute(async () => {
        const response = await fetchJson<ConnectionTestResult>(
          `/api/sync/instances/${instanceId}/test`,
          {
            method: 'POST',
          }
        )

        if (!response.ok) {
          throw new Error(response.error || 'Failed to test connection')
        }

        if (!response.data) {
          throw new Error('No data returned from server')
        }

        return response.data
      })

      if (result) {
        clientLogger.info('Connection test completed', {
          instanceId,
          success: result.success,
        })

        // Update instance with version info if successful
        if (result.success && result.versionInfo) {
          setInstances(prev =>
            prev.map(i =>
              i.id === instanceId
                ? {
                    ...i,
                    schemaVersion: result.versionInfo!.schemaVersion,
                    appVersion: result.versionInfo!.appVersion,
                  }
                : i
            )
          )
          // Show success message with version info
          setSuccess(
            `Connection successful! Remote version: ${result.versionInfo.appVersion}`
          )
          setTimeout(() => setSuccess(null), 5000)
        } else if (result.success) {
          setSuccess('Connection successful!')
          setTimeout(() => setSuccess(null), 5000)
        } else {
          // Connection test returned success:false with an error
          // This will be shown via testOp.error in the UI
          throw new Error(result.error || 'Connection test failed')
        }

        return result
      }

      return null
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [] // testOp.execute is stable (empty deps in useAsyncOperation)
  )

  /**
   * Clear success message
   */
  const clearSuccess = useCallback(() => {
    setSuccess(null)
  }, [])

  // Memoize the return value to prevent unnecessary re-renders
  return useMemo(
    () => ({
      instances,
      success,
      deleteConfirm,
      fetchOp,
      saveOp,
      deleteOp,
      testOp,
      fetchInstances,
      createInstance,
      updateInstance,
      deleteInstance,
      testConnection,
      clearSuccess,
      setDeleteConfirm,
    }),
    [
      instances,
      success,
      deleteConfirm,
      fetchOp,
      saveOp,
      deleteOp,
      testOp,
      fetchInstances,
      createInstance,
      updateInstance,
      deleteInstance,
      testConnection,
      clearSuccess,
    ]
  )
}
