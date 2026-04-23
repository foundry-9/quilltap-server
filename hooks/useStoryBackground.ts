'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
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
 * @param onBackgroundChanged - Optional callback fired when active polling detects a URL change.
 *                              Used to refresh adjacent state (e.g., re-fetch chat messages so
 *                              Lantern announcements posted alongside the new backdrop appear).
 * @returns Background URL, file ID, loading state, and polling controls
 */
export function useStoryBackground(
  chatId: string | null,
  projectId?: string | null,
  enablePassivePolling = false,
  onBackgroundChanged?: () => void
): StoryBackgroundState & {
  refetch: () => Promise<void>
  startPolling: () => void
  stopPolling: () => void
} {
  const [polling, setPolling] = useState(false)

  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const initialUrlRef = useRef<string | null>(null)
  const onBackgroundChangedRef = useRef(onBackgroundChanged)

  useEffect(() => {
    onBackgroundChangedRef.current = onBackgroundChanged
  }, [onBackgroundChanged])

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

  // Derive background state from SWR data
  const backgroundUrl_derived = useMemo(
    () => data?.backgroundUrl || null,
    [data]
  )
  const backgroundFileId_derived = useMemo(
    () => data?.fileId || null,
    [data]
  )
  const backgroundFilename_derived = useMemo(
    () => data?.filename || null,
    [data]
  )

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
    initialUrlRef.current = backgroundUrl_derived

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
        onBackgroundChangedRef.current?.()
        stopPolling()
        return
      }

      // Stop after max polls
      if (pollCount >= maxPolls) {
        stopPolling()
      }
    }, 5000)
  }, [backgroundUrl_derived, mutateBackground, stopPolling])

  // Passive-polling path: SWR revalidates every 30s when enablePassivePolling is true.
  // If the background URL changes between revalidations (because a background job wrote one),
  // notify the caller so it can refresh sibling state (e.g., chat messages).
  const previousUrlRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    const previous = previousUrlRef.current
    previousUrlRef.current = backgroundUrl_derived
    // Skip the initial load — only fire on transitions from a known value.
    if (previous === undefined) return
    if (previous !== backgroundUrl_derived) {
      onBackgroundChangedRef.current?.()
    }
  }, [backgroundUrl_derived])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
      }
    }
  }, [])

  return {
    backgroundUrl: backgroundUrl_derived,
    backgroundFileId: backgroundFileId_derived,
    backgroundFilename: backgroundFilename_derived,
    loading,
    error: error ? (error instanceof Error ? error.message : 'Failed to load background') : null,
    polling,
    refetch: () => mutateBackground().then(() => {}),
    startPolling,
    stopPolling,
  }
}
