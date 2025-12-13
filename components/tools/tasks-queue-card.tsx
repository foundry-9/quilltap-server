'use client'

import { useState, useEffect, useCallback } from 'react'
import { clientLogger } from '@/lib/client-logger'

interface QueueStats {
  pending: number
  processing: number
  failed: number
  completed: number
  dead: number
  activeTotal: number
}

interface JobDetail {
  id: string
  type: string
  typeName: string
  status: 'PENDING' | 'PROCESSING' | 'FAILED'
  priority: number
  attempts: number
  maxAttempts: number
  scheduledAt: string
  startedAt: string | null
  lastError: string | null
  estimatedTokens: number
  chatId?: string
  characterName?: string
}

interface QueueData {
  stats: QueueStats
  jobs: JobDetail[]
  totalEstimatedTokens: number
}

export function TasksQueueCard() {
  const [data, setData] = useState<QueueData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(false)

  const fetchQueueStatus = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      clientLogger.debug('Fetching tasks queue status')

      const res = await fetch('/api/tools/tasks-queue', {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
      })

      if (!res.ok) {
        throw new Error('Failed to fetch queue status')
      }

      const queueData = await res.json()
      setData(queueData)
      clientLogger.debug('Tasks queue status fetched', {
        activeJobs: queueData.stats.activeTotal,
        estimatedTokens: queueData.totalEstimatedTokens,
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      setError(errorMessage)
      clientLogger.error('Failed to fetch tasks queue status', { error: errorMessage })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchQueueStatus()
  }, [fetchQueueStatus])

  // Auto-refresh when enabled
  useEffect(() => {
    if (!autoRefresh) return

    const interval = setInterval(() => {
      fetchQueueStatus()
    }, 5000) // Refresh every 5 seconds

    return () => clearInterval(interval)
  }, [autoRefresh, fetchQueueStatus])

  const formatTokens = (tokens: number): string => {
    if (tokens >= 1000000) {
      return `${(tokens / 1000000).toFixed(1)}M`
    }
    if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}K`
    }
    return tokens.toString()
  }

  const formatDate = (dateString: string): string => {
    try {
      const date = new Date(dateString)
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffMins = Math.floor(diffMs / 60000)

      if (diffMins < 1) return 'Just now'
      if (diffMins < 60) return `${diffMins}m ago`
      if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`
      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return dateString
    }
  }

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'PROCESSING':
        return 'text-blue-600 dark:text-blue-400'
      case 'PENDING':
        return 'text-yellow-600 dark:text-yellow-400'
      case 'FAILED':
        return 'text-red-600 dark:text-red-400'
      default:
        return 'text-muted-foreground'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'PROCESSING':
        return (
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
        )
      case 'PENDING':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        )
      case 'FAILED':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        )
      default:
        return null
    }
  }

  return (
    <div className="qt-card p-6">
      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-foreground mb-1">Tasks Queue</h2>
          <p className="text-muted-foreground">
            Background job queue for memory extraction and other LLM tasks
          </p>
        </div>
        <div className="flex-shrink-0 text-primary">
          <svg
            className="w-8 h-8"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
            />
          </svg>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-destructive/10 border border-destructive text-destructive px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={fetchQueueStatus}
          disabled={loading}
          className="qt-button qt-button-secondary flex items-center gap-2"
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
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            className="rounded border-gray-300 text-primary focus:ring-primary"
          />
          Auto-refresh (5s)
        </label>
      </div>

      {/* Stats Summary */}
      {data && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="qt-card p-3 text-center">
            <div className="text-2xl font-bold text-foreground">
              {data.stats.activeTotal}
            </div>
            <div className="text-xs text-muted-foreground">Active Jobs</div>
          </div>
          <div className="qt-card p-3 text-center">
            <div className="text-2xl font-bold text-foreground">
              ~{formatTokens(data.totalEstimatedTokens)}
            </div>
            <div className="text-xs text-muted-foreground">Est. Tokens</div>
          </div>
          <div className="qt-card p-3 text-center">
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {data.stats.completed}
            </div>
            <div className="text-xs text-muted-foreground">Completed</div>
          </div>
        </div>
      )}

      {/* Detailed Stats Row */}
      {data && (
        <div className="flex flex-wrap gap-4 text-sm mb-4 text-muted-foreground">
          <span>
            <span className="text-blue-600 dark:text-blue-400 font-medium">
              {data.stats.processing}
            </span>{' '}
            processing
          </span>
          <span>
            <span className="text-yellow-600 dark:text-yellow-400 font-medium">
              {data.stats.pending}
            </span>{' '}
            pending
          </span>
          <span>
            <span className="text-red-600 dark:text-red-400 font-medium">
              {data.stats.failed}
            </span>{' '}
            failed
          </span>
          {data.stats.dead > 0 && (
            <span>
              <span className="text-gray-500 font-medium">{data.stats.dead}</span> dead
            </span>
          )}
        </div>
      )}

      {/* Jobs List */}
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-3">Queue Items</h3>

        {loading && !data ? (
          <div className="text-center py-6 text-muted-foreground">
            <svg
              className="animate-spin h-6 w-6 mx-auto mb-2"
              fill="none"
              viewBox="0 0 24 24"
            >
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
            Loading queue...
          </div>
        ) : !data || data.jobs.length === 0 ? (
          <div className="qt-card p-6 text-center">
            <svg
              className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
              />
            </svg>
            <p className="text-muted-foreground">Queue is empty. All tasks completed!</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {data.jobs.map((job) => (
              <div
                key={job.id}
                className="qt-card p-3 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    <span className={getStatusColor(job.status)}>
                      {getStatusIcon(job.status)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">
                          {job.typeName}
                        </span>
                        {job.priority > 0 && (
                          <span className="text-xs px-1.5 py-0.5 bg-primary/10 text-primary rounded">
                            P{job.priority}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {job.characterName && (
                          <span className="mr-2">Character: {job.characterName}</span>
                        )}
                        {job.attempts > 0 && (
                          <span className="mr-2">
                            Attempt {job.attempts}/{job.maxAttempts}
                          </span>
                        )}
                        <span>{formatDate(job.scheduledAt)}</span>
                      </div>
                      {job.lastError && (
                        <div className="text-xs text-red-500 mt-1 truncate">
                          Error: {job.lastError}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground whitespace-nowrap">
                    ~{formatTokens(job.estimatedTokens)} tokens
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
