'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import useSWR from 'swr'

interface StoryBackgroundState {
  backgroundUrl: string | null
  backgroundFileId: string | null
  backgroundFilename: string | null
  loading: boolean
  error: string | null
  polling: boolean
}

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
  const [polling, setPolling] = useState(false)

  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const initialUrlRef = useRef<string | null>(null)

  // Determine which background endpoint to fetch
  let backgroundUrl_toFetch: string | null = null
  if (chatId) {
    backgroundUrl_toFetch = `/api/v1/chats/${chatId}?action=get-background`
  } else if (projectId) {
    backgroundUrl_toFetch = `/api/v1/projects/${projectId}?action=get-background`
  }

  const { data, isLoading: loading, error, mutate: mutateBackground } = useSWR<{
    backgroundUrl?: string
    fileId?: string | null
    filename?: string | null
  }>(backgroundUrl_toFetch, {
    refreshInterval: enablePassivePolling ? 30000 : 0,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  })

  // Update local state from SWR data
  useEffect(() => {
    if (data?.backgroundUrl) {
      setBackgroundUrl(data.backgroundUrl)
      setBackgroundFileId(data.fileId || null)
      setBackgroundFilename(data.filename || null)
    } else {
      setBackgroundUrl(null)
      setBackgroundFileId(null)
      setBackgroundFilename(null)
    }
  }, [data])

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

      const result = await mutateBackground()
      const newUrl = result?.backgroundUrl ?? null

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
  }, [backgroundUrl, mutateBackground, stopPolling])

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
    error: error ? (error instanceof Error ? error.message : 'Failed to load background') : null,
    polling,
    refetch: () => mutateBackground().then(() => {}),
    startPolling,
    stopPolling,
  }
}
