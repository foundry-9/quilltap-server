'use client'

import { useState, useCallback, useMemo } from 'react'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'
import type { SyncDirection } from '@/lib/sync/types'

/**
 * Result type returned from the sync trigger operation
 */
export interface SyncResult {
  success: boolean
  operationId: string
  direction: SyncDirection
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
  const [activeOperationId, setActiveOperationId] = useState<string | null>(null)

  // Async operation hook for sync operations
  const syncOp = useAsyncOperation<SyncResult>()

  /**
   * Trigger a manual sync for a specific instance
   * @param instanceId - The ID of the sync instance
   * @param forceFull - If true, ignores lastSyncAt and syncs all data
   * @param direction - The sync direction: BIDIRECTIONAL, PUSH, or PULL
   * Note: Empty dependency array since syncOp.execute is stable
   */
  const triggerSync = useCallback(
    async (
      instanceId: string,
      forceFull: boolean = false,
      direction: SyncDirection = 'BIDIRECTIONAL'
    ) => {
      setSyncingInstanceId(instanceId)
      setActiveOperationId(null) // Reset for new sync

      const result = await syncOp.execute(async () => {
        // Build URL with action=sync parameter and other options
        const params = new URLSearchParams()
        params.set('action', 'sync')
        if (forceFull) {
          params.set('forceFull', 'true')
        }
        if (direction !== 'BIDIRECTIONAL') {
          params.set('direction', direction)
        }
        const url = `/api/v1/sync/instances/${instanceId}?${params.toString()}`

        const response = await fetchJson<SyncResult>(url, {
          method: 'POST',
        })

        if (!response.ok) {
          throw new Error(response.error || 'Failed to trigger sync')
        }

        if (!response.data) {
          throw new Error('No data returned from server')
        }

        // Store the operation ID for progress polling
        setActiveOperationId(response.data.operationId)

        return response.data
      })

      // Clear syncing state after completion (success or failure)
      setSyncingInstanceId(null)

      if (result) {
      } else {
        console.error('Manual sync failed', { instanceId, forceFull, direction })
      }

      return result
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [] // syncOp.execute is stable (empty deps in useAsyncOperation)
  )

  /**
   * Clear the active operation ID (e.g., after progress bar auto-hides)
   */
  const clearActiveOperation = useCallback(() => {
    setActiveOperationId(null)
  }, [])

  // Memoize the return value to prevent unnecessary re-renders
  return useMemo(
    () => ({
      syncingInstanceId,
      activeOperationId,
      syncOp,
      triggerSync,
      clearActiveOperation,
    }),
    [syncingInstanceId, activeOperationId, syncOp, triggerSync, clearActiveOperation]
  )
}
