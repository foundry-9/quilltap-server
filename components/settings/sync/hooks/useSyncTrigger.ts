'use client'

import { useState, useCallback, useMemo } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'

/**
 * Result type returned from the sync trigger operation
 */
export interface SyncResult {
  success: boolean
  operationId: string
  direction: string
  entityCounts: Record<string, number>
  conflicts: Array<unknown>
  errors: Array<string>
  duration: number
}

/**
 * Hook for triggering manual sync operations
 */
export function useSyncTrigger() {
  const [syncingInstanceId, setSyncingInstanceId] = useState<string | null>(null)

  // Async operation hook for sync operations
  const syncOp = useAsyncOperation<SyncResult>()

  /**
   * Trigger a manual sync for a specific instance
   * Note: Empty dependency array since syncOp.execute is stable
   */
  const triggerSync = useCallback(
    async (instanceId: string) => {
      clientLogger.debug('Triggering manual sync', { instanceId })
      setSyncingInstanceId(instanceId)

      const result = await syncOp.execute(async () => {
        const response = await fetchJson<SyncResult>(
          `/api/sync/instances/${instanceId}/sync`,
          {
            method: 'POST',
          }
        )

        if (!response.ok) {
          throw new Error(response.error || 'Failed to trigger sync')
        }

        if (!response.data) {
          throw new Error('No data returned from server')
        }

        return response.data
      })

      // Clear syncing state after completion (success or failure)
      setSyncingInstanceId(null)

      if (result) {
        clientLogger.info('Manual sync completed', {
          instanceId,
          operationId: result.operationId,
          direction: result.direction,
          entityCounts: result.entityCounts,
          conflictCount: result.conflicts.length,
          errorCount: result.errors.length,
          duration: result.duration,
        })
      } else {
        clientLogger.error('Manual sync failed', { instanceId })
      }

      return result
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [] // syncOp.execute is stable (empty deps in useAsyncOperation)
  )

  // Memoize the return value to prevent unnecessary re-renders
  return useMemo(
    () => ({
      syncingInstanceId,
      syncOp,
      triggerSync,
    }),
    [syncingInstanceId, syncOp, triggerSync]
  )
}
