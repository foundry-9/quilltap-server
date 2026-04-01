'use client'

/**
 * Cleanup Panel
 *
 * UI component for resetting sync state.
 * Allows users to clean up legacy sync mappings and operation history,
 * and reset instance sync timestamps to allow a fresh sync.
 *
 * @module components/settings/sync/components/CleanupPanel
 */

import { useState, useEffect } from 'react'
import { CleanupResult } from '../hooks'

interface CleanupPanelProps {
  showConfirm: boolean
  lastResult: CleanupResult | null
  isLoading: boolean
  error: string | null
  onShowConfirm: (show: boolean) => void
  onCleanup: () => Promise<CleanupResult | null>
  onClearResult: () => void
}

export function CleanupPanel({
  showConfirm,
  lastResult,
  isLoading,
  error,
  onShowConfirm,
  onCleanup,
  onClearResult,
}: CleanupPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  // Log renders
  useEffect(() => {
  }, [showConfirm, lastResult, isExpanded])

  return (
    <div className="qt-bg-surface qt-border rounded-lg">
      {/* Header - clickable to expand/collapse */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <svg
            className="w-5 h-5 qt-text-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          <h3 className="qt-text-primary font-medium">Reset Sync State</h3>
        </div>
        <svg
          className={`w-5 h-5 qt-text-muted transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-4 border-t qt-border">
          {/* Description */}
          <p className="qt-text-small text-muted-foreground mt-3">
            Reset your sync state if you&apos;re experiencing issues like duplicate entities or broken references.
            This removes sync operation history and resets timestamps so you can perform a fresh sync.
          </p>

          {/* Success result display */}
          {lastResult && lastResult.success && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 dark:bg-green-900/20 dark:border-green-800">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-green-800 dark:text-green-200 font-medium mb-2">
                    Sync State Reset Successfully
                  </p>
                  <ul className="text-green-700 dark:text-green-300 text-sm space-y-1">
                    <li>Mappings deleted: {lastResult.mappingsDeleted}</li>
                    <li>Operations deleted: {lastResult.operationsDeleted}</li>
                    <li>Instances reset: {lastResult.instancesReset}</li>
                  </ul>
                  <p className="text-green-600 dark:text-green-400 text-sm mt-3">
                    Now perform a &quot;Force Full Sync&quot; on each instance to re-sync all data.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClearResult}
                  className="text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-200"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Error display */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded p-3 text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-200 text-sm">
              {error}
            </div>
          )}

          {/* Action buttons */}
          {!lastResult && (
            <div className="space-y-3">
              {showConfirm ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 dark:bg-amber-900/20 dark:border-amber-800">
                  <p className="text-amber-800 dark:text-amber-200 font-medium mb-2">
                    Are you sure?
                  </p>
                  <p className="text-amber-700 dark:text-amber-300 text-sm mb-4">
                    This will delete all sync mappings and operation history. Your actual data (characters, chats, etc.) will not be affected.
                    After resetting, use &quot;Force Full Sync&quot; on each instance to restore full sync.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={onCleanup}
                      disabled={isLoading}
                      className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isLoading ? 'Resetting...' : 'Yes, Reset Sync State'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onShowConfirm(false)}
                      disabled={isLoading}
                      className="px-4 py-2 qt-bg-muted qt-text-secondary rounded hover:opacity-80 transition-opacity"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onShowConfirm(true)}
                  className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700 transition-colors"
                >
                  Reset Sync State
                </button>
              )}
            </div>
          )}

          {/* Loading state */}
          {isLoading && (
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-amber-600"></div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
