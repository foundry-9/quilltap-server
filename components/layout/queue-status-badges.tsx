'use client'

/**
 * Queue Status Badges
 *
 * Displays a compact badge group in the page toolbar showing active job counts
 * for each background queue: memory, embedding, summarization, danger
 * classification, and story background generation.
 *
 * Polling is event-driven:
 * - Starts on route change (page navigation)
 * - Starts when notifyQueueChange() is called (job enqueued)
 * - Stops automatically when all counts reach zero
 *
 * @module components/layout/queue-status-badges
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { usePathname } from 'next/navigation'

/** Custom event name for queue change notifications */
const QUEUE_CHANGE_EVENT = 'quilltap:queue-change'

/**
 * Notify the queue status badges that jobs have been enqueued.
 * Call this from any client-side code after an action that creates background jobs.
 */
export function notifyQueueChange() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(QUEUE_CHANGE_EVENT))
  }
}

/**
 * Queue types we display and their corresponding job type keys
 */
const QUEUE_TYPES = [
  {
    key: 'memory',
    label: 'Mem',
    title: 'Memory extraction queue',
    jobTypes: ['MEMORY_EXTRACTION', 'INTER_CHARACTER_MEMORY'],
    badgeClass: 'qt-queue-badge-memory',
  },
  {
    key: 'embedding',
    label: 'Emb',
    title: 'Embedding queue',
    jobTypes: ['EMBEDDING_GENERATE', 'EMBEDDING_REFIT', 'EMBEDDING_REINDEX_ALL'],
    badgeClass: 'qt-queue-badge-embedding',
  },
  {
    key: 'summary',
    label: 'Sum',
    title: 'Post-turn processing queue (summaries, titles, scene state, rendering)',
    jobTypes: ['CONTEXT_SUMMARY', 'TITLE_UPDATE', 'SCENE_STATE_TRACKING', 'CONVERSATION_RENDER'],
    badgeClass: 'qt-queue-badge-summary',
  },
  {
    key: 'danger',
    label: 'Dgr',
    title: 'Danger classification queue',
    jobTypes: ['CHAT_DANGER_CLASSIFICATION'],
    badgeClass: 'qt-queue-badge-danger',
  },
  {
    key: 'story',
    label: 'Img',
    title: 'Image generation queue (story backgrounds, character avatars)',
    jobTypes: ['STORY_BACKGROUND_GENERATION', 'CHARACTER_AVATAR_GENERATION'],
    badgeClass: 'qt-queue-badge-story',
  },
] as const

/** Polling interval in milliseconds */
const POLL_INTERVAL = 5000

/**
 * Check if any queue has active jobs
 */
function hasActiveJobs(activeByType: Record<string, number>): boolean {
  return Object.values(activeByType).some((count) => count > 0)
}

/**
 * Hook to poll queue status from the API, driven by route changes and custom events.
 * Starts polling on trigger, stops when all counts reach zero.
 */
function useQueueStatus() {
  const [activeByType, setActiveByType] = useState<Record<string, number>>({})
  const mountedRef = useRef(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pathname = usePathname()
  const pathnameRef = useRef(pathname)

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const fetchStatus = useCallback(async (): Promise<Record<string, number>> => {
    try {
      const res = await fetch('/api/v1/system/jobs', {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
      })

      if (!res.ok) {
        return {}
      }

      const data = await res.json()
      const counts = data.activeByType || {}
      if (mountedRef.current) {
        setActiveByType(counts)
      }
      return counts
    } catch {
      return {}
    }
  }, [])

  const startPolling = useCallback(() => {
    // Don't start if already polling
    if (intervalRef.current) return

    intervalRef.current = setInterval(async () => {
      const counts = await fetchStatus()
      if (!hasActiveJobs(counts)) {
        stopPolling()
      }
    }, POLL_INTERVAL)
  }, [fetchStatus, stopPolling])

  const checkAndPoll = useCallback(async () => {
    const counts = await fetchStatus()
    if (hasActiveJobs(counts)) {
      startPolling()
    }
  }, [fetchStatus, startPolling])

  // On route change: stop current polling and trigger a fresh check via event
  useEffect(() => {
    if (pathnameRef.current !== pathname) {
      pathnameRef.current = pathname
      stopPolling()
      notifyQueueChange()
    }
  }, [pathname, stopPolling])

  // Subscribe to queue-change events for all triggers (route change, job enqueue, initial mount)
  useEffect(() => {
    mountedRef.current = true

    const handleQueueChange = () => {
      checkAndPoll()
    }

    window.addEventListener(QUEUE_CHANGE_EVENT, handleQueueChange)
    // Trigger initial check on mount via event
    notifyQueueChange()

    return () => {
      mountedRef.current = false
      stopPolling()
      window.removeEventListener(QUEUE_CHANGE_EVENT, handleQueueChange)
    }
  }, [checkAndPoll, stopPolling])

  return activeByType
}

/**
 * Get the total count for a queue from the activeByType record
 */
function getQueueCount(activeByType: Record<string, number>, jobTypes: readonly string[]): number {
  return jobTypes.reduce((sum, type) => sum + (activeByType[type] || 0), 0)
}

/**
 * Queue Status Badges component
 *
 * Renders a compact badge group showing active job counts for each queue type.
 * Badges dim when their count is 0.
 */
export function QueueStatusBadges() {
  const activeByType = useQueueStatus()

  return (
    <div className="qt-queue-badge-group" title="Background job queues">
      {QUEUE_TYPES.map((queue) => {
        const count = getQueueCount(activeByType, queue.jobTypes)
        const isIdle = count === 0

        return (
          <span
            key={queue.key}
            className={`${queue.badgeClass}${isIdle ? ' qt-queue-badge-idle' : ''}`}
            title={`${queue.title}: ${count} active`}
          >
            <span>{queue.label}</span>
            <span>{count}</span>
          </span>
        )
      })}
    </div>
  )
}
