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
   * @param instanceId - The ID of the sync instance
   * @param forceFull - If true, ignores lastSyncAt and syncs all data
   * Note: Empty dependency array since syncOp.execute is stable
   */
  const triggerSync = useCallback(
    async (instanceId: string, forceFull: boolean = false) => {
      clientLogger.debug('Triggering manual sync', { instanceId, forceFull })
      setSyncingInstanceId(instanceId)

      const result = await syncOp.execute(async () => {
        const url = forceFull
          ? `/api/sync/instances/${instanceId}/sync?forceFull=true`
          : `/api/sync/instances/${instanceId}/sync`
        const response = await fetchJson<SyncResult>(url, {
          method: 'POST',
        })

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
          forceFull,
          operationId: result.operationId,
          direction: result.direction,
          entityCounts: result.entityCounts,
          conflictCount: result.conflicts?.length ?? 0,
          errorCount: result.errors?.length ?? 0,
          duration: result.duration,
        })
      } else {
        clientLogger.error('Manual sync failed', { instanceId, forceFull })
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
