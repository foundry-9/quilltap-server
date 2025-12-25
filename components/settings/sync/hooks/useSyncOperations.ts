'use client'

import { useState, useCallback, useMemo } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'
import { SyncOperationDisplay } from '../types'

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
 * Hook for managing sync operation history data
 */
export function useSyncOperations() {
  const [operations, setOperations] = useState<SyncOperationDisplay[]>([])

  // Async operation hook
  const fetchOp = useAsyncOperation<SyncOperationDisplay[]>()

  /**
   * Fetch sync operation history from the server
   * Uses retry logic to handle transient connection errors during startup
   * Optionally filter by instance ID
   * Note: Empty dependency array since fetchOp.execute is stable
   */
  const fetchOperations = useCallback(async (instanceId?: string) => {
    clientLogger.debug('Fetching sync operations', { instanceId })

    const url = instanceId
      ? `/api/sync/operations?instanceId=${encodeURIComponent(instanceId)}`
      : '/api/sync/operations'

    const result = await fetchOp.execute(async () => {
      return fetchWithRetry(async () => {
        const response = await fetchJson<{ operations: SyncOperationDisplay[] }>(url)
        clientLogger.debug('Sync operations response', {
          ok: response.ok,
          status: response.status,
          hasData: !!response.data,
          error: response.error || undefined,
        })
        if (!response.ok) {
          throw new Error(response.error || 'Failed to fetch sync operations')
        }
        return response.data?.operations || []
      })
    })

    if (result) {
      setOperations(result)
      clientLogger.debug('Fetched sync operations', { count: result.length })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // fetchOp.execute is stable (empty deps in useAsyncOperation)

  // Memoize the return value to prevent unnecessary re-renders
  return useMemo(
    () => ({
      operations,
      fetchOp,
      fetchOperations,
    }),
    [
      operations,
      fetchOp,
      fetchOperations,
    ]
  )
}
