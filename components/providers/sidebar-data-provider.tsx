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
  projectId?: string | null
  projectName?: string | null
  projectColor?: string | null
}

export interface SidebarProject {
  id: string
  name: string
  color?: string | null
  icon?: string | null
  chatCount: number
  fileCount: number
  characterCount: number
  updatedAt: string
}

interface SidebarDataContextValue {
  characters: SidebarCharacter[]
  chats: SidebarChat[]
  projects: SidebarProject[]
  loading: boolean
  refreshSidebar: () => Promise<void>
  refreshCharacters: () => Promise<void>
  refreshChats: () => Promise<void>
  refreshProjects: () => Promise<void>
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
  const [projects, setProjects] = useState<SidebarProject[]>([])
  const [loading, setLoading] = useState(true)

  // Refs for debouncing
  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pendingRefreshRef = useRef<{ characters: boolean; chats: boolean; projects: boolean }>({
    characters: false,
    chats: false,
    projects: false,
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
   * Fetch projects from sidebar API
   */
  const fetchProjects = useCallback(async () => {
    try {
      clientLogger.debug('SidebarDataProvider: Fetching projects')
      const response = await fetch('/api/sidebar/projects')
      if (!response.ok) {
        throw new Error(`Failed to fetch projects: ${response.status}`)
      }
      const data = await response.json()
      setProjects(data.projects || [])
      clientLogger.debug('SidebarDataProvider: Fetched projects', {
        count: data.projects?.length || 0,
      })
    } catch (error) {
      clientLogger.error('SidebarDataProvider: Failed to fetch projects', {
        error: error instanceof Error ? error.message : String(error),
      })
      setProjects([])
    }
  }, [])

  /**
   * Execute pending refreshes with debouncing
   */
  const executePendingRefresh = useCallback(async () => {
    const pending = pendingRefreshRef.current
    pendingRefreshRef.current = { characters: false, chats: false, projects: false }

    clientLogger.debug('SidebarDataProvider: Executing pending refresh', { pending })

    const promises: Promise<void>[] = []
    if (pending.characters) {
      promises.push(fetchCharacters())
    }
    if (pending.chats) {
      promises.push(fetchChats())
    }
    if (pending.projects) {
      promises.push(fetchProjects())
    }

    if (promises.length > 0) {
      await Promise.all(promises)
    }
  }, [fetchCharacters, fetchChats, fetchProjects])

  /**
   * Schedule a debounced refresh
   */
  const scheduleRefresh = useCallback(
    (refreshCharacters: boolean, refreshChats: boolean, refreshProjects: boolean = false) => {
      // Mark what needs to be refreshed
      if (refreshCharacters) {
        pendingRefreshRef.current.characters = true
      }
      if (refreshChats) {
        pendingRefreshRef.current.chats = true
      }
      if (refreshProjects) {
        pendingRefreshRef.current.projects = true
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
   * Refresh all sidebar data (characters, chats, and projects)
   */
  const refreshSidebar = useCallback(async () => {
    clientLogger.debug('SidebarDataProvider: refreshSidebar called')
    scheduleRefresh(true, true, true)
  }, [scheduleRefresh])

  /**
   * Refresh only characters
   */
  const refreshCharactersOnly = useCallback(async () => {
    clientLogger.debug('SidebarDataProvider: refreshCharacters called')
    scheduleRefresh(true, false, false)
  }, [scheduleRefresh])

  /**
   * Refresh only chats
   */
  const refreshChatsOnly = useCallback(async () => {
    clientLogger.debug('SidebarDataProvider: refreshChats called')
    scheduleRefresh(false, true, false)
  }, [scheduleRefresh])

  /**
   * Refresh only projects
   */
  const refreshProjectsOnly = useCallback(async () => {
    clientLogger.debug('SidebarDataProvider: refreshProjects called')
    scheduleRefresh(false, false, true)
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
        setProjects([])
      }
      return
    }

    const loadInitialData = async () => {
      setLoading(true)
      clientLogger.debug('SidebarDataProvider: Loading initial data')
      await Promise.all([fetchCharacters(), fetchChats(), fetchProjects()])
      setLoading(false)
      clientLogger.debug('SidebarDataProvider: Initial data loaded')
    }

    loadInitialData()
  }, [status, fetchCharacters, fetchChats, fetchProjects])

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
      projects,
      loading,
      refreshSidebar,
      refreshCharacters: refreshCharactersOnly,
      refreshChats: refreshChatsOnly,
      refreshProjects: refreshProjectsOnly,
    }),
    [characters, chats, projects, loading, refreshSidebar, refreshCharactersOnly, refreshChatsOnly, refreshProjectsOnly]
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
