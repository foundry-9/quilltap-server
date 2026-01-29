'use client'

/**
 * Sidebar Provider
 *
 * Manages the left sidebar state (collapsed/expanded).
 * Persists collapsed preference to localStorage.
 *
 * @module components/providers/sidebar-provider
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

const API_DEBOUNCE_MS = 500

/** Default sidebar width in pixels */
export const DEFAULT_SIDEBAR_WIDTH = 256
/** Minimum sidebar width in pixels */
export const MIN_SIDEBAR_WIDTH = 256
/** Maximum sidebar width in pixels */
export const MAX_SIDEBAR_WIDTH = 512

interface SidebarContextValue {
  /** Whether the sidebar is collapsed (desktop) */
  isCollapsed: boolean
  /** Current sidebar width in pixels */
  width: number
  /** Toggle collapsed state (desktop) */
  toggleCollapse: () => void
  /** Set collapsed state explicitly */
  setCollapsed: (collapsed: boolean) => void
  /** Set sidebar width (clamped to min/max) */
  setWidth: (width: number) => void
  /** Reset sidebar width to default */
  resetWidth: () => void
  /** Which sections are collapsed (by section id) */
  sectionCollapsed: Record<string, boolean>
  /** Toggle a section's collapsed state */
  toggleSectionCollapsed: (sectionId: string) => void
}

const STORAGE_KEY = 'quilltap.sidebar.collapsed'
const WIDTH_STORAGE_KEY = 'quilltap.sidebar.width'
const SECTIONS_STORAGE_KEY = 'quilltap.sidebar.sections.collapsed'

const SidebarContext = createContext<SidebarContextValue | null>(null)

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [storageReady, setStorageReady] = useState(false)
  const [width, setWidthState] = useState(DEFAULT_SIDEBAR_WIDTH)
  const [sectionCollapsed, setSectionCollapsed] = useState<Record<string, boolean>>({})

  // Load collapsed state, width, and section states from localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw === 'true') {
        setIsCollapsed(true)
      }

      const widthRaw = window.localStorage.getItem(WIDTH_STORAGE_KEY)
      if (widthRaw) {
        const parsedWidth = parseInt(widthRaw, 10)
        if (!isNaN(parsedWidth) && parsedWidth >= MIN_SIDEBAR_WIDTH && parsedWidth <= MAX_SIDEBAR_WIDTH) {
          setWidthState(parsedWidth)
        }
      }

      const sectionsRaw = window.localStorage.getItem(SECTIONS_STORAGE_KEY)
      if (sectionsRaw) {
        const parsed = JSON.parse(sectionsRaw)
        if (typeof parsed === 'object' && parsed !== null) {
          setSectionCollapsed(parsed)
        }
      }
    } catch (error) {
      console.warn('Unable to load sidebar preferences', {
        error: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setStorageReady(true)
    }
  }, [])

  // Persist collapsed state to localStorage when changed
  useEffect(() => {
    if (!storageReady || typeof window === 'undefined') return
    try {
      window.localStorage.setItem(STORAGE_KEY, String(isCollapsed))
    } catch (error) {
      console.warn('Unable to persist sidebar collapsed preference', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }, [isCollapsed, storageReady])

  // Persist width to localStorage when changed
  useEffect(() => {
    if (!storageReady || typeof window === 'undefined') return
    try {
      window.localStorage.setItem(WIDTH_STORAGE_KEY, String(width))
    } catch (error) {
      console.warn('Unable to persist sidebar width', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }, [width, storageReady])

  // Persist section collapsed states to localStorage when changed
  useEffect(() => {
    if (!storageReady || typeof window === 'undefined') return
    try {
      window.localStorage.setItem(SECTIONS_STORAGE_KEY, JSON.stringify(sectionCollapsed))
    } catch (error) {
      console.warn('Unable to persist section collapsed states', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }, [sectionCollapsed, storageReady])

  // Debounced API persistence for sidebar width
  const apiDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const lastApiWidthRef = useRef<number>(DEFAULT_SIDEBAR_WIDTH)

  // Fetch initial width from API on mount
  useEffect(() => {
    if (typeof window === 'undefined') return

    const fetchFromApi = async () => {
      try {
        const response = await fetch('/api/v1/settings/chat')
        if (response.ok) {
          const settings = await response.json()
          if (settings.sidebarWidth && settings.sidebarWidth !== width) {
            const apiWidth = settings.sidebarWidth
            if (apiWidth >= MIN_SIDEBAR_WIDTH && apiWidth <= MAX_SIDEBAR_WIDTH) {
              setWidthState(apiWidth)
              lastApiWidthRef.current = apiWidth
            }
          }
        }
      } catch {
        // Could not fetch - may not be authenticated
      }
    }

    // Small delay to avoid race with other initialization
    const timeout = setTimeout(fetchFromApi, 100)
    return () => clearTimeout(timeout)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Debounced save to API when width changes
  useEffect(() => {
    if (!storageReady || typeof window === 'undefined') return
    if (width === lastApiWidthRef.current) return

    // Clear any existing debounce
    if (apiDebounceRef.current) {
      clearTimeout(apiDebounceRef.current)
    }

    apiDebounceRef.current = setTimeout(async () => {
      try {
        const response = await fetch('/api/v1/settings/chat', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sidebarWidth: width }),
        })
        if (response.ok) {
          lastApiWidthRef.current = width
        }
      } catch {
        // Could not save to API
      }
    }, API_DEBOUNCE_MS)

    return () => {
      if (apiDebounceRef.current) {
        clearTimeout(apiDebounceRef.current)
      }
    }
  }, [width, storageReady])

  // Cross-tab sync via storage event
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY && event.newValue !== null) {
        const newValue = event.newValue === 'true'
        setIsCollapsed(newValue)
      } else if (event.key === WIDTH_STORAGE_KEY && event.newValue !== null) {
        const parsedWidth = parseInt(event.newValue, 10)
        if (!isNaN(parsedWidth) && parsedWidth >= MIN_SIDEBAR_WIDTH && parsedWidth <= MAX_SIDEBAR_WIDTH) {
          setWidthState(parsedWidth)
        }
      } else if (event.key === SECTIONS_STORAGE_KEY && event.newValue !== null) {
        try {
          const parsed = JSON.parse(event.newValue)
          if (typeof parsed === 'object' && parsed !== null) {
            setSectionCollapsed(parsed)
          }
        } catch {
          // Ignore invalid JSON
        }
      }
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  const toggleCollapse = useCallback(() => {
    setIsCollapsed(prev => {
      const next = !prev
      return next
    })
  }, [])

  const setCollapsed = useCallback((collapsed: boolean) => {
    setIsCollapsed(collapsed)
  }, [])

  const setWidth = useCallback((newWidth: number) => {
    const clampedWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, newWidth))
    setWidthState(clampedWidth)
  }, [])

  const resetWidth = useCallback(() => {
    setWidthState(DEFAULT_SIDEBAR_WIDTH)
  }, [])

  const toggleSectionCollapsed = useCallback((sectionId: string) => {
    setSectionCollapsed(prev => {
      const next = { ...prev, [sectionId]: !prev[sectionId] }
      return next
    })
  }, [])

  const value = useMemo<SidebarContextValue>(
    () => ({
      isCollapsed,
      width,
      toggleCollapse,
      setCollapsed,
      setWidth,
      resetWidth,
      sectionCollapsed,
      toggleSectionCollapsed,
    }),
    [isCollapsed, width, toggleCollapse, setCollapsed, setWidth, resetWidth, sectionCollapsed, toggleSectionCollapsed]
  )

  return (
    <SidebarContext.Provider value={value}>
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar() {
  const ctx = useContext(SidebarContext)
  if (!ctx) {
    throw new Error('useSidebar must be used within a SidebarProvider')
  }
  return ctx
}

/**
 * Optional hook that returns null if used outside provider context.
 * Useful for components that may be rendered before provider is mounted.
 */
export function useSidebarOptional() {
  return useContext(SidebarContext)
}
