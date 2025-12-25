'use client'

import { useState, useCallback, useMemo } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'
import { SyncOperationDisplay } from '../types'

/**
 * Hook for managing sync operation history data
 */
export function useSyncOperations() {
  const [operations, setOperations] = useState<SyncOperationDisplay[]>([])

  // Async operation hook
  const fetchOp = useAsyncOperation<SyncOperationDisplay[]>()

  /**
   * Fetch sync operation history from the server
   * Optionally filter by instance ID
   * Note: Empty dependency array since fetchOp.execute is stable
   */
  const fetchOperations = useCallback(async (instanceId?: string) => {
    clientLogger.debug('Fetching sync operations', { instanceId })

    const url = instanceId
      ? `/api/sync/operations?instanceId=${encodeURIComponent(instanceId)}`
      : '/api/sync/operations'

    const result = await fetchOp.execute(async () => {
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
