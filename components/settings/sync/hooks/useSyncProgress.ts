'use client'

/**
 * useSyncProgress Hook
 *
 * Polls the sync progress endpoint to get real-time updates during sync operations.
 * Automatically starts polling when an operationId is provided and stops when complete.
 *
 * @module components/settings/sync/hooks/useSyncProgress
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchJson } from '@/lib/fetch-helpers'
import type { SyncProgress, SyncDirection, SyncOperationStatus } from '@/lib/sync/types'

/**
 * Response from the progress endpoint
 */
export interface SyncProgressResponse {
  operationId: string
  instanceId: string
  status: SyncOperationStatus
  direction: SyncDirection
  progress: SyncProgress | null
  entityCounts: Record<string, number>
  errors: string[]
  conflicts: Array<unknown>
  startedAt: string
  completedAt: string | null
}

/**
 * State returned by the hook
 */
export interface UseSyncProgressResult {
  /** Current progress state (null if not polling) */
  progress: SyncProgressResponse | null
  /** Whether the sync is complete */
  isComplete: boolean
  /** Whether the sync failed */
  isFailed: boolean
  /** Any error from polling */
  error: string | null
  /** Clear the progress state (call after auto-hide timeout) */
  clearProgress: () => void
}

/**
 * Hook for polling sync progress during operations
 *
 * @param operationId - The operation ID to poll (null to stop polling)
 * @param instanceName - The name of the instance being synced (for display)
 * @param pollingInterval - How often to poll in ms (default 1500ms)
 */
export function useSyncProgress(
  operationId: string | null,
  instanceName: string = '',
  pollingInterval: number = 1500
): UseSyncProgressResult {
  const [progress, setProgress] = useState<SyncProgressResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isComplete, setIsComplete] = useState(false)
  const [isFailed, setIsFailed] = useState(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const isPollingRef = useRef(false)
  // Use a ref to track completion state for the interval callback to avoid stale closures
  const isCompleteRef = useRef(false)

  // Fetch progress from API
  const fetchProgress = useCallback(async (opId: string) => {
    if (isPollingRef.current) return // Prevent concurrent requests

    isPollingRef.current = true

    try {
      const response = await fetchJson<SyncProgressResponse>(
        `/api/v1/sync/operations/${opId}?action=progress`,
        { method: 'GET' }
      )

      if (!response.ok) {
        throw new Error(response.error || 'Failed to fetch progress')
      }

      if (response.data) {
        setProgress(response.data)

        // Check if complete
        if (response.data.status === 'COMPLETED') {
          isCompleteRef.current = true
          setIsComplete(true)
          setIsFailed(response.data.errors?.length > 0)
        } else if (response.data.status === 'FAILED') {
          isCompleteRef.current = true
          setIsComplete(true)
          setIsFailed(true)
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      console.warn('Error fetching sync progress', {
        operationId: opId,
        error: errorMessage,
      })
      // Don't set error for transient network issues - keep polling
      // Only set error if it's a 404 or other terminal error
      if (errorMessage.includes('not found') || errorMessage.includes('404')) {
        setError(errorMessage)
      }
    } finally {
      isPollingRef.current = false
    }
  }, [])

  // Start/stop polling when operationId changes
  useEffect(() => {
    // Clear previous state when operation changes
    if (operationId) {
      setProgress(null)
      setError(null)
      setIsComplete(false)
      setIsFailed(false)
      isCompleteRef.current = false


      // Fetch immediately
      fetchProgress(operationId)

      // Start polling - use ref to check completion status to avoid stale closure
      intervalRef.current = setInterval(() => {
        if (!isCompleteRef.current) {
          fetchProgress(operationId)
        } else {
          // Stop polling when complete
          if (intervalRef.current) {
            clearInterval(intervalRef.current)
            intervalRef.current = null
          }
        }
      }, pollingInterval)
    }

    // Cleanup
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [operationId, pollingInterval, fetchProgress, instanceName])

  // Stop polling when complete
  useEffect(() => {
    if ((isComplete || isFailed) && intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [isComplete, isFailed, operationId])

  // Clear progress (called after auto-hide)
  const clearProgress = useCallback(() => {
    setProgress(null)
    setError(null)
    setIsComplete(false)
    setIsFailed(false)
    isCompleteRef.current = false
  }, [])

  return {
    progress,
    isComplete,
    isFailed,
    error,
    clearProgress,
  }
}
