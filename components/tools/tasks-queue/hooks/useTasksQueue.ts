'use client'

import { useState, useCallback, useEffect } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { getErrorMessage } from '@/lib/error-utils'
import type { QueueData, FullJobDetail } from '../types'

export function useTasksQueue() {
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

  const controlQueue = useCallback(
    async (action: 'start' | 'stop') => {
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
    },
    [fetchQueueStatus]
  )

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

  const pauseJob = useCallback(
    async (jobId: string) => {
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
    },
    [fetchQueueStatus]
  )

  const resumeJob = useCallback(
    async (jobId: string) => {
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
    },
    [fetchQueueStatus]
  )

  const deleteJob = useCallback(
    async (jobId: string) => {
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
    },
    [fetchQueueStatus, selectedJob?.id]
  )

  // Initial fetch
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

  return {
    data,
    loading,
    error,
    autoRefresh,
    setAutoRefresh,
    controlLoading,
    selectedJob,
    setSelectedJob,
    jobActionLoading,
    showJobDialog,
    setShowJobDialog,
    fetchQueueStatus,
    controlQueue,
    viewJob,
    pauseJob,
    resumeJob,
    deleteJob,
  }
}
