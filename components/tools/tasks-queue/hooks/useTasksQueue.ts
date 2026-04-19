'use client'

import { useState, useCallback, useEffect } from 'react'
import useSWR from 'swr'
import { getErrorMessage } from '@/lib/error-utils'
import type { QueueData, FullJobDetail } from '../types'

export function useTasksQueue() {
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [controlLoading, setControlLoading] = useState(false)
  const [selectedJob, setSelectedJob] = useState<FullJobDetail | null>(null)
  const [jobActionLoading, setJobActionLoading] = useState<string | null>(null)
  const [showJobDialog, setShowJobDialog] = useState(false)

  // Fetch queue status via SWR with optional polling
  const { data: swrData, isLoading: loading, error: loadError, mutate: mutateQueue } = useSWR<QueueData>(
    '/api/v1/system/tools?action=tasks-queue',
    { refreshInterval: autoRefresh ? 5000 : 0 }
  )

  const data = swrData ?? null

  const [error, setError] = useState<string | null>(null)

  // Sync error from SWR
  useEffect(() => {
    if (loadError) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync SWR error to local error state so handlers can also set errors
      setError(getErrorMessage(loadError))
    } else {
      setError(null)
    }
  }, [loadError])
  const fetchQueueStatus = useCallback(async () => {
    await mutateQueue()
  }, [mutateQueue])

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

        await res.json()

        // Refresh the queue status to get updated processor state
        await mutateQueue()
      } catch (err) {
        const errorMessage = getErrorMessage(err)
        setError(errorMessage)
        console.error(`Failed to ${action} queue`, { error: errorMessage })
      } finally {
        setControlLoading(false)
      }
    },
    [mutateQueue]
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

        await mutateQueue()
      } catch (err) {
        const errorMessage = getErrorMessage(err)
        console.error('Failed to pause job', { error: errorMessage })
      } finally {
        setJobActionLoading(null)
      }
    },
    [mutateQueue]
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

        await mutateQueue()
      } catch (err) {
        const errorMessage = getErrorMessage(err)
        console.error('Failed to resume job', { error: errorMessage })
      } finally {
        setJobActionLoading(null)
      }
    },
    [mutateQueue]
  )

  const deleteJob = async (jobId: string) => {
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

      await mutateQueue()
    } catch (err) {
      const errorMessage = getErrorMessage(err)
      console.error('Failed to delete job', { error: errorMessage })
    } finally {
      setJobActionLoading(null)
    }
  }

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
