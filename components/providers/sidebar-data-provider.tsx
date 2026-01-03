'use client'

/**
 * Sidebar Data Provider
 *
 * Centralizes sidebar data fetching for characters and chats.
 * Provides a refresh mechanism that can be called from anywhere
 * in the app after mutations to characters or chats.
 *
 * @module components/providers/sidebar-data-provider
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '@/components/providers/session-provider'
import { clientLogger } from '@/lib/client-logger'

// ============================================================================
// TYPES
// ============================================================================

export interface SidebarCharacter {
  id: string
  name: string
  avatarUrl?: string | null
  defaultImage?: string | null
  isFavorite?: boolean
  chatCount?: number
  tags?: string[]
}

export interface SidebarChatParticipant {
  id: string
  name: string
  avatarUrl?: string | null
}

export interface SidebarChat {
  id: string
  title?: string | null
  updatedAt: string
  participants: SidebarChatParticipant[]
  characterTags?: string[]
  messageCount?: number
}

interface SidebarDataContextValue {
  characters: SidebarCharacter[]
  chats: SidebarChat[]
  loading: boolean
  refreshSidebar: () => Promise<void>
  refreshCharacters: () => Promise<void>
  refreshChats: () => Promise<void>
}

// ============================================================================
// CONTEXT
// ============================================================================

const SidebarDataContext = createContext<SidebarDataContextValue | null>(null)

// Debounce delay in milliseconds
const DEBOUNCE_DELAY = 300

// ============================================================================
// PROVIDER
// ============================================================================

export function SidebarDataProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession()
  const [characters, setCharacters] = useState<SidebarCharacter[]>([])
  const [chats, setChats] = useState<SidebarChat[]>([])
  const [loading, setLoading] = useState(true)

  // Refs for debouncing
  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pendingRefreshRef = useRef<{ characters: boolean; chats: boolean }>({
    characters: false,
    chats: false,
  })

  /**
   * Fetch characters from sidebar API
   */
  const fetchCharacters = useCallback(async () => {
    try {
      clientLogger.debug('SidebarDataProvider: Fetching characters')
      const response = await fetch('/api/sidebar/characters')
      if (!response.ok) {
        throw new Error(`Failed to fetch characters: ${response.status}`)
      }
      const data = await response.json()
      setCharacters(data.characters || [])
      clientLogger.debug('SidebarDataProvider: Fetched characters', {
        count: data.characters?.length || 0,
      })
    } catch (error) {
      clientLogger.error('SidebarDataProvider: Failed to fetch characters', {
        error: error instanceof Error ? error.message : String(error),
      })
      setCharacters([])
    }
  }, [])

  /**
   * Fetch chats from sidebar API
   */
  const fetchChats = useCallback(async () => {
    try {
      clientLogger.debug('SidebarDataProvider: Fetching chats')
      const response = await fetch('/api/sidebar/chats')
      if (!response.ok) {
        throw new Error(`Failed to fetch chats: ${response.status}`)
      }
      const data = await response.json()
      setChats(data.chats || [])
      clientLogger.debug('SidebarDataProvider: Fetched chats', {
        count: data.chats?.length || 0,
      })
    } catch (error) {
      clientLogger.error('SidebarDataProvider: Failed to fetch chats', {
        error: error instanceof Error ? error.message : String(error),
      })
      setChats([])
    }
  }, [])

  /**
   * Execute pending refreshes with debouncing
   */
  const executePendingRefresh = useCallback(async () => {
    const pending = pendingRefreshRef.current
    pendingRefreshRef.current = { characters: false, chats: false }

    clientLogger.debug('SidebarDataProvider: Executing pending refresh', { pending })

    const promises: Promise<void>[] = []
    if (pending.characters) {
      promises.push(fetchCharacters())
    }
    if (pending.chats) {
      promises.push(fetchChats())
    }

    if (promises.length > 0) {
      await Promise.all(promises)
    }
  }, [fetchCharacters, fetchChats])

  /**
   * Schedule a debounced refresh
   */
  const scheduleRefresh = useCallback(
    (refreshCharacters: boolean, refreshChats: boolean) => {
      // Mark what needs to be refreshed
      if (refreshCharacters) {
        pendingRefreshRef.current.characters = true
      }
      if (refreshChats) {
        pendingRefreshRef.current.chats = true
      }

      // Clear existing timeout
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current)
      }

      // Schedule new refresh
      refreshTimeoutRef.current = setTimeout(() => {
        executePendingRefresh()
      }, DEBOUNCE_DELAY)
    },
    [executePendingRefresh]
  )

  /**
   * Refresh both characters and chats
   */
  const refreshSidebar = useCallback(async () => {
    clientLogger.debug('SidebarDataProvider: refreshSidebar called')
    scheduleRefresh(true, true)
  }, [scheduleRefresh])

  /**
   * Refresh only characters
   */
  const refreshCharactersOnly = useCallback(async () => {
    clientLogger.debug('SidebarDataProvider: refreshCharacters called')
    scheduleRefresh(true, false)
  }, [scheduleRefresh])

  /**
   * Refresh only chats
   */
  const refreshChatsOnly = useCallback(async () => {
    clientLogger.debug('SidebarDataProvider: refreshChats called')
    scheduleRefresh(false, true)
  }, [scheduleRefresh])

  /**
   * Initial fetch on authentication
   */
  useEffect(() => {
    if (status !== 'authenticated') {
      setLoading(false)
      if (status === 'unauthenticated') {
        setCharacters([])
        setChats([])
      }
      return
    }

    const loadInitialData = async () => {
      setLoading(true)
      clientLogger.debug('SidebarDataProvider: Loading initial data')
      await Promise.all([fetchCharacters(), fetchChats()])
      setLoading(false)
      clientLogger.debug('SidebarDataProvider: Initial data loaded')
    }

    loadInitialData()
  }, [status, fetchCharacters, fetchChats])

  /**
   * Cleanup timeout on unmount
   */
  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current)
      }
    }
  }, [])

  const value = useMemo<SidebarDataContextValue>(
    () => ({
      characters,
      chats,
      loading,
      refreshSidebar,
      refreshCharacters: refreshCharactersOnly,
      refreshChats: refreshChatsOnly,
    }),
    [characters, chats, loading, refreshSidebar, refreshCharactersOnly, refreshChatsOnly]
  )

  return <SidebarDataContext.Provider value={value}>{children}</SidebarDataContext.Provider>
}

// ============================================================================
// HOOK
// ============================================================================

export function useSidebarData() {
  const ctx = useContext(SidebarDataContext)
  if (!ctx) {
    throw new Error('useSidebarData must be used within a SidebarDataProvider')
  }
  return ctx
}

/**
 * Optional hook that returns null if not within provider
 * Useful for components that might be rendered outside the provider
 */
export function useSidebarDataOptional() {
  return useContext(SidebarDataContext)
}
