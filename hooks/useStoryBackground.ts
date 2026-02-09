'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface StoryBackgroundState {
  backgroundUrl: string | null
  backgroundFileId: string | null
  backgroundFilename: string | null
  loading: boolean
  error: string | null
  polling: boolean
}

// Slow poll interval for passive background checks (30 seconds)
const PASSIVE_POLL_INTERVAL = 30000

/**
 * Hook to fetch and manage story background for a chat or project
 *
 * @param chatId - The chat ID to get background for
 * @param projectId - Optional project ID (for project-level backgrounds)
 * @param enablePassivePolling - If true, polls every 30s to detect background changes
 * @returns Background URL, file ID, loading state, and polling controls
 */
export function useStoryBackground(
  chatId: string | null,
  projectId?: string | null,
  enablePassivePolling = false
): StoryBackgroundState & {
  refetch: () => Promise<void>
  startPolling: () => void
  stopPolling: () => void
} {
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null)
  const [backgroundFileId, setBackgroundFileId] = useState<string | null>(null)
  const [backgroundFilename, setBackgroundFilename] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [polling, setPolling] = useState(false)

  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const initialUrlRef = useRef<string | null>(null)

  const fetchBackground = useCallback(async (silent = false): Promise<string | null> => {
    if (!chatId && !projectId) {
      setBackgroundUrl(null)
      setBackgroundFileId(null)
      setBackgroundFilename(null)
      return null
    }

    if (!silent) {
      setLoading(true)
      setError(null)
    }

    try {
      // First try to get the chat's background
      if (chatId) {
        const res = await fetch(`/api/v1/chats/${chatId}?action=get-background`)
        if (res.ok) {
          const data = await res.json()
          if (data.backgroundUrl) {
            setBackgroundUrl(data.backgroundUrl)
            setBackgroundFileId(data.fileId || null)
            setBackgroundFilename(data.filename || null)
            if (!silent) setLoading(false)
            return data.backgroundUrl
          }
        }
      }

      // If no chat background, try project background
      if (projectId) {
        const res = await fetch(`/api/v1/projects/${projectId}?action=get-background`)
        if (res.ok) {
          const data = await res.json()
          if (data.backgroundUrl) {
            setBackgroundUrl(data.backgroundUrl)
            setBackgroundFileId(data.fileId || null)
            setBackgroundFilename(data.filename || null)
            if (!silent) setLoading(false)
            return data.backgroundUrl
          }
        }
      }

      // No background found
      setBackgroundUrl(null)
      setBackgroundFileId(null)
      setBackgroundFilename(null)
      return null
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to load background'
      console.error('Error fetching story background:', errorMsg)
      if (!silent) setError(errorMsg)
      setBackgroundUrl(null)
      setBackgroundFileId(null)
      setBackgroundFilename(null)
      return null
    } finally {
      if (!silent) setLoading(false)
    }
  }, [chatId, projectId])

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
    }
    setPolling(false)
    initialUrlRef.current = null
  }, [])

  const startPolling = useCallback(() => {
    // Store current URL to detect changes
    initialUrlRef.current = backgroundUrl

    // Don't start if already polling
    if (pollingIntervalRef.current) {
      return
    }

    setPolling(true)

    // Poll every 5 seconds for up to 3 minutes
    let pollCount = 0
    const maxPolls = 36 // 3 minutes at 5-second intervals

    pollingIntervalRef.current = setInterval(async () => {
      pollCount++

      const newUrl = await fetchBackground(true)

      // Stop if we detect a change (new URL or URL appeared where there was none)
      if (newUrl !== initialUrlRef.current) {
        stopPolling()
        return
      }

      // Stop after max polls
      if (pollCount >= maxPolls) {
        stopPolling()
      }
    }, 5000)
  }, [backgroundUrl, fetchBackground, stopPolling])

  // Initial fetch
  useEffect(() => {
    fetchBackground()
  }, [fetchBackground])

  // Passive polling - checks every 30s for background changes when enabled
  useEffect(() => {
    if (!enablePassivePolling || !chatId) {
      return
    }

    const passiveInterval = setInterval(() => {
      // Don't passive poll while active polling is happening
      if (!pollingIntervalRef.current) {
        fetchBackground(true)
      }
    }, PASSIVE_POLL_INTERVAL)

    return () => {
      clearInterval(passiveInterval)
    }
  }, [enablePassivePolling, chatId, fetchBackground])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
      }
    }
  }, [])

  return {
    backgroundUrl,
    backgroundFileId,
    backgroundFilename,
    loading,
    error,
    polling,
    refetch: () => fetchBackground(false).then(() => {}),
    startPolling,
    stopPolling,
  }
}
