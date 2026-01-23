'use client'

import { useState, useCallback, useMemo } from 'react'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'

/**
 * Result type returned from the sync cleanup operation
 */
export interface CleanupResult {
  success: boolean
  mappingsDeleted: number
  operationsDeleted: number
  instancesReset: number
}

/**
 * Hook for managing sync data cleanup operations
 */
export function useSyncCleanup() {
  const [showConfirm, setShowConfirm] = useState(false)
  const [lastResult, setLastResult] = useState<CleanupResult | null>(null)

  // Async operation hook for cleanup
  const cleanupOp = useAsyncOperation<CleanupResult>()

  /**
   * Execute the cleanup operation
   */
  const executeCleanup = useCallback(async () => {
    const result = await cleanupOp.execute(async () => {
      const response = await fetchJson<CleanupResult>('/api/v1/sync?action=cleanup', {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error(response.error || 'Failed to clean sync data')
      }

      if (!response.data) {
        throw new Error('No data returned from server')
      }

      return response.data
    })

    if (result) {
      setLastResult(result)
      setShowConfirm(false)
    }

    return result
  }, [cleanupOp])

  /**
   * Clear the last result message
   */
  const clearResult = useCallback(() => {
    setLastResult(null)
  }, [])

  // Memoize the return value to prevent unnecessary re-renders
  return useMemo(
    () => ({
      showConfirm,
      setShowConfirm,
      lastResult,
      cleanupOp,
      executeCleanup,
      clearResult,
    }),
    [showConfirm, lastResult, cleanupOp, executeCleanup, clearResult]
  )
}
