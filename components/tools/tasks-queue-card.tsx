'use client'

import { useState, useEffect, useCallback } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { getErrorMessage } from '@/lib/error-utils'

interface QueueStats {
  pending: number
  processing: number
  failed: number
  completed: number
  dead: number
  paused: number
  activeTotal: number
}

interface ProcessorStatus {
  running: boolean
  processing: boolean
}

interface JobDetail {
  id: string
  type: string
  typeName: string
  status: 'PENDING' | 'PROCESSING' | 'FAILED' | 'PAUSED'
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

interface FullJobDetail extends JobDetail {
  payload: Record<string, unknown>
  createdAt: string
  updatedAt: string
  userId: string
}

interface QueueData {
  stats: QueueStats
  jobs: JobDetail[]
  totalEstimatedTokens: number
  processorStatus: ProcessorStatus
}

export function TasksQueueCard() {
  const [data, setData] = useState<QueueData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [controlLoading, setControlLoading] = useState(false)
  const [selectedJob, setSelectedJob] = useState<FullJobDetail | null>(null)
  const [jobActionLoading, setJobActionLoading] = useState<string | null>(null)
  const [showJobDialog, setShowJobDialog] = useState(false)

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
      const errorMessage = getErrorMessage(err)
      setError(errorMessage)
      clientLogger.error('Failed to fetch tasks queue status', { error: errorMessage })
    } finally {
      setLoading(false)
    }
  }, [])

  const controlQueue = useCallback(async (action: 'start' | 'stop') => {
    try {
      setControlLoading(true)
      setError(null)
      clientLogger.debug(`Sending queue control action: ${action}`)

      const res = await fetch('/api/tools/tasks-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })

      if (!res.ok) {
        throw new Error(`Failed to ${action} queue`)
      }

      const result = await res.json()
      clientLogger.info(`Queue ${action} action completed`, { result })

      // Refresh the queue status to get updated processor state
      await fetchQueueStatus()
    } catch (err) {
      const errorMessage = getErrorMessage(err)
      setError(errorMessage)
      clientLogger.error(`Failed to ${action} queue`, { error: errorMessage })
    } finally {
      setControlLoading(false)
    }
  }, [fetchQueueStatus])

  const viewJob = useCallback(async (jobId: string) => {
    try {
      setJobActionLoading(jobId)
      clientLogger.debug('Fetching job details', { jobId })

      const res = await fetch(`/api/background-jobs/${jobId}`)
      if (!res.ok) {
        throw new Error('Failed to fetch job details')
      }

      const job = await res.json()
      setSelectedJob(job)
      setShowJobDialog(true)
      clientLogger.debug('Job details fetched', { jobId })
    } catch (err) {
      const errorMessage = getErrorMessage(err)
      setError(errorMessage)
      clientLogger.error('Failed to fetch job details', { error: errorMessage })
    } finally {
      setJobActionLoading(null)
    }
  }, [])

  const pauseJob = useCallback(async (jobId: string) => {
    try {
      setJobActionLoading(jobId)
      clientLogger.debug('Pausing job', { jobId })

      const res = await fetch(`/api/background-jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pause' }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to pause job')
      }

      clientLogger.info('Job paused', { jobId })
      await fetchQueueStatus()
    } catch (err) {
      const errorMessage = getErrorMessage(err)
      setError(errorMessage)
      clientLogger.error('Failed to pause job', { error: errorMessage })
    } finally {
      setJobActionLoading(null)
    }
  }, [fetchQueueStatus])

  const resumeJob = useCallback(async (jobId: string) => {
    try {
      setJobActionLoading(jobId)
      clientLogger.debug('Resuming job', { jobId })

      const res = await fetch(`/api/background-jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resume' }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to resume job')
      }

      clientLogger.info('Job resumed', { jobId })
      await fetchQueueStatus()
    } catch (err) {
      const errorMessage = getErrorMessage(err)
      setError(errorMessage)
      clientLogger.error('Failed to resume job', { error: errorMessage })
    } finally {
      setJobActionLoading(null)
    }
  }, [fetchQueueStatus])

  const deleteJob = useCallback(async (jobId: string) => {
    try {
      setJobActionLoading(jobId)
      clientLogger.debug('Deleting job', { jobId })

      const res = await fetch(`/api/background-jobs/${jobId}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete job')
      }

      clientLogger.info('Job deleted', { jobId })

      // Close dialog if we deleted the selected job
      if (selectedJob?.id === jobId) {
        setShowJobDialog(false)
        setSelectedJob(null)
      }

      await fetchQueueStatus()
    } catch (err) {
      const errorMessage = getErrorMessage(err)
      setError(errorMessage)
      clientLogger.error('Failed to delete job', { error: errorMessage })
    } finally {
      setJobActionLoading(null)
    }
  }, [fetchQueueStatus, selectedJob?.id])

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
      case 'PAUSED':
        return 'text-orange-600 dark:text-orange-400'
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
      case 'PAUSED':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"
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
      <div className="flex items-center gap-3 mb-4 flex-wrap">
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

        {/* Queue Control Buttons */}
        <button
          onClick={() => controlQueue('start')}
          disabled={controlLoading || data?.processorStatus?.running || !data?.stats?.activeTotal}
          className="qt-button qt-button-primary flex items-center gap-2"
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
          onClick={() => controlQueue('stop')}
          disabled={controlLoading || !data?.processorStatus?.running || !data?.stats?.activeTotal}
          className="qt-button qt-button-secondary flex items-center gap-2"
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

        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            className="rounded border-gray-300 text-primary focus:ring-primary"
          />
          Auto-refresh (5s)
        </label>

        {/* Processor Status Indicator */}
        {data && (
          <span className={`text-sm flex items-center gap-1.5 ml-auto ${data.processorStatus?.running ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
            <span className={`w-2 h-2 rounded-full ${data.processorStatus?.running ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
            {data.processorStatus?.running ? 'Queue Running' : 'Queue Stopped'}
          </span>
        )}
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
          {data.stats.paused > 0 && (
            <span>
              <span className="text-orange-600 dark:text-orange-400 font-medium">{data.stats.paused}</span> paused
            </span>
          )}
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
                  <div className="flex items-center gap-2">
                    <div className="text-right text-xs text-muted-foreground whitespace-nowrap">
                      ~{formatTokens(job.estimatedTokens)} tokens
                    </div>
                    {/* Job Action Buttons */}
                    <div className="flex items-center gap-1">
                      {/* Pause/Resume Button */}
                      {job.status === 'PAUSED' ? (
                        <button
                          onClick={() => resumeJob(job.id)}
                          disabled={jobActionLoading === job.id}
                          className="p-1 rounded hover:bg-green-100 dark:hover:bg-green-900/30 text-green-600 dark:text-green-400"
                          title="Resume"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                          </svg>
                        </button>
                      ) : ['PENDING', 'FAILED'].includes(job.status) ? (
                        <button
                          onClick={() => pauseJob(job.id)}
                          disabled={jobActionLoading === job.id}
                          className="p-1 rounded hover:bg-orange-100 dark:hover:bg-orange-900/30 text-orange-600 dark:text-orange-400"
                          title="Pause"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6" />
                          </svg>
                        </button>
                      ) : null}
                      {/* View Button */}
                      <button
                        onClick={() => viewJob(job.id)}
                        disabled={jobActionLoading === job.id}
                        className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                        title="View Details"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      </button>
                      {/* Delete Button */}
                      {job.status !== 'PROCESSING' && (
                        <button
                          onClick={() => deleteJob(job.id)}
                          disabled={jobActionLoading === job.id}
                          className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400"
                          title="Delete"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                      {/* Loading indicator */}
                      {jobActionLoading === job.id && (
                        <svg className="w-4 h-4 animate-spin text-muted-foreground" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Job Detail Dialog */}
      {showJobDialog && selectedJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowJobDialog(false)}>
          <div className="bg-background rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Dialog Header */}
            <div className="flex items-center justify-between p-4 border-b">
              <div>
                <h3 className="text-lg font-semibold text-foreground">Job Details</h3>
                <p className="text-sm text-muted-foreground">{selectedJob.type}</p>
              </div>
              <button
                onClick={() => setShowJobDialog(false)}
                className="p-1 rounded hover:bg-muted"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Dialog Content */}
            <div className="p-4 overflow-y-auto max-h-[calc(80vh-140px)]">
              {/* Status and metadata */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <span className="text-xs text-muted-foreground">Status</span>
                  <div className={`font-medium ${getStatusColor(selectedJob.status)}`}>
                    {selectedJob.status}
                  </div>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Priority</span>
                  <div className="font-medium">{selectedJob.priority}</div>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Attempts</span>
                  <div className="font-medium">{selectedJob.attempts} / {selectedJob.maxAttempts}</div>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Scheduled</span>
                  <div className="font-medium text-sm">{formatDate(selectedJob.scheduledAt)}</div>
                </div>
              </div>

              {selectedJob.lastError && (
                <div className="mb-4">
                  <span className="text-xs text-muted-foreground">Last Error</span>
                  <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded mt-1">
                    {selectedJob.lastError}
                  </div>
                </div>
              )}

              {/* Payload (what will be sent to LLM) */}
              <div>
                <span className="text-xs text-muted-foreground">Job Payload (sent to LLM)</span>
                <pre className="mt-1 p-3 bg-muted rounded text-xs overflow-x-auto whitespace-pre-wrap break-words">
                  {JSON.stringify(selectedJob.payload, null, 2)}
                </pre>
              </div>
            </div>

            {/* Dialog Footer */}
            <div className="flex items-center justify-between p-4 border-t bg-muted/30">
              <button
                onClick={() => setShowJobDialog(false)}
                className="qt-button qt-button-secondary"
              >
                Close
              </button>
              {selectedJob.status !== 'PROCESSING' && (
                <button
                  onClick={() => deleteJob(selectedJob.id)}
                  disabled={jobActionLoading === selectedJob.id}
                  className="qt-button bg-red-600 hover:bg-red-700 text-white flex items-center gap-2"
                >
                  {jobActionLoading === selectedJob.id ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  )}
                  Delete Job
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
