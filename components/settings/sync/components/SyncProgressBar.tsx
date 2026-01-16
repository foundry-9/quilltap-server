'use client'

/**
 * SyncProgressBar Component
 *
 * Displays real-time sync progress with a progress bar, phase indicator,
 * and current item being synced. Auto-hides after completion.
 *
 * @module components/settings/sync/components/SyncProgressBar
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import type { SyncProgressResponse } from '../hooks/useSyncProgress'

interface SyncProgressBarProps {
  /** Progress data from useSyncProgress hook */
  progress: SyncProgressResponse | null
  /** Name of the instance being synced */
  instanceName: string
  /** Whether the sync is complete */
  isComplete: boolean
  /** Whether the sync failed */
  isFailed: boolean
  /** Called when the progress bar should be dismissed */
  onDismiss: () => void
  /** Auto-hide delay in ms after completion (default 3000) */
  autoHideDelay?: number
}

/**
 * Get phase display name
 */
function getPhaseLabel(phase: string | undefined): string {
  switch (phase) {
    case 'HANDSHAKE':
      return 'Connecting...'
    case 'PULL':
      return 'Pulling changes'
    case 'FETCH_FILES':
      return 'Downloading files'
    case 'PUSH':
      return 'Pushing changes'
    case 'COMPLETE':
      return 'Complete'
    case 'ERROR':
      return 'Error'
    default:
      return 'Syncing...'
  }
}

/**
 * Get direction display name
 */
function getDirectionLabel(direction: string): string {
  switch (direction) {
    case 'PUSH':
      return 'Push'
    case 'PULL':
      return 'Pull'
    case 'BIDIRECTIONAL':
    default:
      return 'Two-way'
  }
}

/**
 * Calculate progress percentage
 */
function calculateProgress(progress: SyncProgressResponse | null): number {
  if (!progress?.progress) return 0

  const { phase, pulled, pushed, filesFetched, estimatedTotal } = progress.progress

  // Phase-based weighting
  const phaseWeight: Record<string, number> = {
    HANDSHAKE: 5,
    PULL: 40,
    FETCH_FILES: 20,
    PUSH: 30,
    COMPLETE: 100,
    ERROR: 100,
  }

  const baseProgress = phaseWeight[phase] || 0

  // If we have counts, calculate more precise progress
  if (estimatedTotal && estimatedTotal > 0) {
    const currentCount = pulled + pushed + filesFetched
    const countProgress = (currentCount / estimatedTotal) * 100
    return Math.min(countProgress, 95) // Never show 100% until complete
  }

  // Use phase-based progress
  if (phase === 'COMPLETE' || phase === 'ERROR') {
    return 100
  }

  // Return base phase progress with some dynamic adjustment
  const counts = (pulled || 0) + (pushed || 0) + (filesFetched || 0)
  const dynamicBonus = Math.min(counts * 0.5, 10) // Small bonus per item

  return Math.min(baseProgress + dynamicBonus, 95)
}

/**
 * Progress bar component for sync operations
 */
export function SyncProgressBar({
  progress,
  instanceName,
  isComplete,
  isFailed,
  onDismiss,
  autoHideDelay = 3000,
}: SyncProgressBarProps) {
  const [isVisible, setIsVisible] = useState(true)
  const [isFadingOut, setIsFadingOut] = useState(false)
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Log mount
  useEffect(() => {
  }, [instanceName, progress])

  // Handle auto-hide after completion
  const startAutoHide = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
    }

    // Start fade out
    hideTimeoutRef.current = setTimeout(() => {
      setIsFadingOut(true)

      // After fade animation, fully hide
      hideTimeoutRef.current = setTimeout(() => {
        setIsVisible(false)
        onDismiss()
      }, 300) // Match CSS transition duration
    }, autoHideDelay)
  }, [autoHideDelay, onDismiss])

  // Start auto-hide when complete (but not failed)
  useEffect(() => {
    if (isComplete && !isFailed) {
      startAutoHide()
    }

    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current)
      }
    }
  }, [isComplete, isFailed, startAutoHide])

  // Don't render if not visible
  if (!isVisible || !progress) {
    return null
  }

  const progressPercent = calculateProgress(progress)
  const phaseLabel = getPhaseLabel(progress.progress?.phase)
  const directionLabel = getDirectionLabel(progress.direction)
  const currentItem = progress.progress?.currentItemName
  const currentEntity = progress.progress?.currentEntity
  const message = progress.progress?.message

  // Stats
  const pulled = progress.progress?.pulled || progress.entityCounts?.pulled || 0
  const pushed = progress.progress?.pushed || progress.entityCounts?.pushed || 0
  const files = progress.progress?.filesFetched || progress.entityCounts?.filesFetched || 0
  const errorCount = progress.errors?.length || 0

  return (
    <div
      className={`qt-bg-surface qt-border rounded-lg p-4 mb-4 shadow-md transition-opacity duration-300 ${
        isFadingOut ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {isComplete && !isFailed ? (
            <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : isFailed ? (
            <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <span className="qt-spinner-sm" />
          )}
          <span className="qt-text-primary font-medium">
            {isComplete
              ? isFailed
                ? `Sync failed with "${instanceName}"`
                : `Sync complete with "${instanceName}"`
              : `Syncing with "${instanceName}"`}
          </span>
          <span className="qt-text-small text-muted-foreground">({directionLabel})</span>
        </div>
        {isFailed && (
          <button
            type="button"
            onClick={onDismiss}
            className="qt-button-secondary qt-button-sm"
          >
            Dismiss
          </button>
        )}
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 mb-2">
        <div
          className={`h-2.5 rounded-full transition-all duration-300 ${
            isFailed ? 'bg-red-500' : isComplete ? 'bg-green-500' : 'bg-blue-500'
          }`}
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Phase and current item */}
      <div className="flex items-center justify-between qt-text-small">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Phase:</span>
          <span className="qt-text-primary">{phaseLabel}</span>
        </div>
        <div className="qt-text-primary tabular-nums">
          {progressPercent.toFixed(0)}%
        </div>
      </div>

      {/* Current item */}
      {currentItem && !isComplete && (
        <div className="mt-1 qt-text-small text-muted-foreground truncate">
          {currentEntity && <span className="capitalize">{currentEntity.toLowerCase()}: </span>}
          <span className="qt-text-primary">{currentItem}</span>
        </div>
      )}

      {/* Message (used for error display) */}
      {isFailed && message && (
        <div className="mt-2 qt-text-small text-red-500 dark:text-red-400">
          Error: {message}
        </div>
      )}

      {/* Stats */}
      <div className="mt-2 flex gap-4 qt-text-small text-muted-foreground">
        <span>Pulled: <span className="qt-text-primary">{pulled}</span></span>
        <span>Pushed: <span className="qt-text-primary">{pushed}</span></span>
        <span>Files: <span className="qt-text-primary">{files}</span></span>
        {errorCount > 0 && (
          <span className="text-red-500">Errors: <span className="font-medium">{errorCount}</span></span>
        )}
      </div>
    </div>
  )
}
