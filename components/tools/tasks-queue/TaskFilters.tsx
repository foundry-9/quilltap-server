'use client'

import { Icon } from '@/components/ui/icon'
import type { QueueData } from './types'
import { Spinner } from '@/components/ui/Spinner'

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
          <Spinner className="w-4 h-4" />
        ) : (
          <Icon name="refresh" className="w-4 h-4" />
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
          <Spinner className="w-4 h-4" />
        ) : (
          <Icon name="play" className="w-4 h-4" />
        )}
        Start Queue
      </button>

      <button
        onClick={onStop}
        disabled={controlLoading || !data?.processorStatus?.running || !data?.stats?.activeTotal}
        className="qt-button qt-button-secondary"
      >
        {controlLoading ? (
          <Spinner className="w-4 h-4" />
        ) : (
          <Icon name="stop" className="w-4 h-4" />
        )}
        Stop Queue
      </button>

      {/*
        The queue keeps itself current over the realtime socket; this switch
        governs the fallback poll, which only runs when that socket is down.
      */}
      <label
        className="flex items-center gap-2 qt-text-small cursor-pointer"
        title="Should the ledger be re-read every five seconds whenever the live wire is down?"
      >
        <input
          type="checkbox"
          checked={autoRefresh}
          onChange={(e) => onAutoRefreshChange(e.target.checked)}
          className="rounded qt-border-default qt-text-brand qt-focus-ring"
        />
        Fallback polling (5s)
      </label>

      {/* Processor Status Indicator */}
      {data && (
        <span
          className={`qt-text-small flex items-center gap-1.5 ml-auto ${
            data.processorStatus?.running
              ? 'qt-text-success'
              : 'qt-text-secondary'
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              data.processorStatus?.running
                ? 'qt-bg-success animate-pulse'
                : 'qt-bg-muted-foreground'
            }`}
          />
          {data.processorStatus?.running ? 'Queue Running' : 'Queue Stopped'}
        </span>
      )}
    </div>
  )
}
