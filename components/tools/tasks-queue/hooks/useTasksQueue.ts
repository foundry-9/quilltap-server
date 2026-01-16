'use client'

import { useState, useCallback, useEffect } from 'react'
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

      const res = await fetch('/api/v1/system/tools?action=tasks-queue', {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
      })

      if (!res.ok) {
        throw new Error('Failed to fetch queue status')
      }

      const queueData = await res.json()
      setData(queueData)
    } catch (err) {
      const errorMessage = getErrorMessage(err)
      setError(errorMessage)
      console.error('Failed to fetch tasks queue status', { error: errorMessage })
    } finally {
      setLoading(false)
    }
  }, [])

  const controlQueue = useCallback(
    async (action: 'start' | 'stop') => {
      try {
        setControlLoading(true)
        setError(null)

        const res = await fetch('/api/v1/system/tools?action=tasks-queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        })

        if (!res.ok) {
          throw new Error(`Failed to ${action} queue`)
        }

        const result = await res.json()

        // Refresh the queue status to get updated processor state
        await fetchQueueStatus()
      } catch (err) {
        const errorMessage = getErrorMessage(err)
        setError(errorMessage)
        console.error(`Failed to ${action} queue`, { error: errorMessage })
      } finally {
        setControlLoading(false)
      }
    },
    [fetchQueueStatus]
  )

  const viewJob = useCallback(async (jobId: string) => {
    try {
      setJobActionLoading(jobId)
      const res = await fetch(`/api/v1/system/jobs/${jobId}`)
      if (!res.ok) {
        throw new Error('Failed to fetch job details')
      }

      const data = await res.json()
      setSelectedJob(data.job)
      setShowJobDialog(true)
    } catch (err) {
      const errorMessage = getErrorMessage(err)
      setError(errorMessage)
      console.error('Failed to fetch job details', { error: errorMessage })
    } finally {
      setJobActionLoading(null)
    }
  }, [])

  const pauseJob = useCallback(
    async (jobId: string) => {
      try {
        setJobActionLoading(jobId)

        const res = await fetch(`/api/v1/system/jobs/${jobId}?action=pause`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to pause job')
        }

        await fetchQueueStatus()
      } catch (err) {
        const errorMessage = getErrorMessage(err)
        setError(errorMessage)
        console.error('Failed to pause job', { error: errorMessage })
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

        const res = await fetch(`/api/v1/system/jobs/${jobId}?action=resume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to resume job')
        }

        await fetchQueueStatus()
      } catch (err) {
        const errorMessage = getErrorMessage(err)
        setError(errorMessage)
        console.error('Failed to resume job', { error: errorMessage })
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

        const res = await fetch(`/api/v1/system/jobs/${jobId}`, {
          method: 'DELETE',
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to delete job')
        }

        // Close dialog if we deleted the selected job
        if (selectedJob?.id === jobId) {
          setShowJobDialog(false)
          setSelectedJob(null)
        }

        await fetchQueueStatus()
      } catch (err) {
        const errorMessage = getErrorMessage(err)
        setError(errorMessage)
        console.error('Failed to delete job', { error: errorMessage })
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
