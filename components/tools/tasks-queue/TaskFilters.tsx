'use client'

import type { QueueData } from './types'

interface TaskFiltersProps {
  data: QueueData | null
  loading: boolean
  controlLoading: boolean
  autoRefresh: boolean
  onRefresh: () => void
  onStart: () => void
  onStop: () => void
  onAutoRefreshChange: (checked: boolean) => void
}

export function TaskFilters({
  data,
  loading,
  controlLoading,
  autoRefresh,
  onRefresh,
  onStart,
  onStop,
  onAutoRefreshChange,
}: TaskFiltersProps) {
  return (
    <div className="flex items-center gap-3 mb-4 flex-wrap">
      <button
        onClick={onRefresh}
        disabled={loading}
        className="qt-button qt-button-secondary"
      >
        {loading ? (
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        )}
        Refresh
      </button>

      {/* Queue Control Buttons */}
      <button
        onClick={onStart}
        disabled={controlLoading || data?.processorStatus?.running || !data?.stats?.activeTotal}
        className="qt-button qt-button-primary"
      >
        {controlLoading ? (
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        )}
        Start Queue
      </button>

      <button
        onClick={onStop}
        disabled={controlLoading || !data?.processorStatus?.running || !data?.stats?.activeTotal}
        className="qt-button qt-button-secondary"
      >
        {controlLoading ? (
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"
            />
          </svg>
        )}
        Stop Queue
      </button>

      <label className="flex items-center gap-2 qt-text-small cursor-pointer">
        <input
          type="checkbox"
          checked={autoRefresh}
          onChange={(e) => onAutoRefreshChange(e.target.checked)}
          className="rounded border-gray-300 text-primary focus:ring-primary"
        />
        Auto-refresh (5s)
      </label>

      {/* Processor Status Indicator */}
      {data && (
        <span
          className={`qt-text-small flex items-center gap-1.5 ml-auto ${
            data.processorStatus?.running
              ? 'text-green-600 dark:text-green-400'
              : 'text-muted-foreground'
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              data.processorStatus?.running
                ? 'bg-green-500 animate-pulse'
                : 'bg-gray-400'
            }`}
          />
          {data.processorStatus?.running ? 'Queue Running' : 'Queue Stopped'}
        </span>
      )}
    </div>
  )
}
