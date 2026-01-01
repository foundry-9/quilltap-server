'use client'

/**
 * Sidebar Provider
 *
 * Manages the left sidebar state (collapsed/expanded, mobile open/closed).
 * Persists collapsed preference to localStorage.
 *
 * @module components/providers/sidebar-provider
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { clientLogger } from '@/lib/client-logger'

interface SidebarContextValue {
  /** Whether the sidebar is collapsed (desktop) */
  isCollapsed: boolean
  /** Whether the sidebar is open on mobile */
  isMobileOpen: boolean
  /** Toggle collapsed state (desktop) */
  toggleCollapse: () => void
  /** Set collapsed state explicitly */
  setCollapsed: (collapsed: boolean) => void
  /** Open sidebar on mobile */
  openMobile: () => void
  /** Close sidebar on mobile */
  closeMobile: () => void
  /** Whether we're on a mobile viewport */
  isMobile: boolean
}

const STORAGE_KEY = 'quilltap.sidebar.collapsed'
const MOBILE_BREAKPOINT = 768

const SidebarContext = createContext<SidebarContextValue | null>(null)

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [storageReady, setStorageReady] = useState(false)

  // Load collapsed state from localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw === 'true') {
        setIsCollapsed(true)
        clientLogger.debug('Loaded sidebar collapsed preference from localStorage', { isCollapsed: true })
      }
    } catch (error) {
      clientLogger.warn('Unable to load sidebar collapsed preference', {
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
      clientLogger.debug('Persisted sidebar collapsed preference', { isCollapsed })
    } catch (error) {
      clientLogger.warn('Unable to persist sidebar collapsed preference', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }, [isCollapsed, storageReady])

  // Cross-tab sync via storage event
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || event.newValue === null) return
      const newValue = event.newValue === 'true'
      clientLogger.debug('Sidebar collapsed preference changed in another tab', { isCollapsed: newValue })
      setIsCollapsed(newValue)
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  // Track viewport width for mobile detection
  useEffect(() => {
    if (typeof window === 'undefined') return

    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)

    const updateMobile = () => {
      const mobile = mediaQuery.matches
      setIsMobile(mobile)
      // Close mobile menu when switching to desktop
      if (!mobile) {
        setIsMobileOpen(false)
      }
      clientLogger.debug('Viewport mobile check', { isMobile: mobile, viewportWidth: window.innerWidth })
    }

    updateMobile()
    mediaQuery.addEventListener('change', updateMobile)
    return () => mediaQuery.removeEventListener('change', updateMobile)
  }, [])

  // Close mobile sidebar when pressing Escape
  useEffect(() => {
    if (!isMobileOpen) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMobileOpen(false)
        clientLogger.debug('Closed mobile sidebar via Escape key')
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isMobileOpen])

  // Prevent body scroll when mobile sidebar is open
  useEffect(() => {
    if (typeof document === 'undefined') return
    if (isMobileOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isMobileOpen])

  const toggleCollapse = useCallback(() => {
    setIsCollapsed(prev => {
      const next = !prev
      queueMicrotask(() => {
        clientLogger.info('Toggled sidebar collapse', { from: prev, to: next })
      })
      return next
    })
  }, [])

  const setCollapsed = useCallback((collapsed: boolean) => {
    queueMicrotask(() => {
      clientLogger.info('Set sidebar collapsed', { collapsed })
    })
    setIsCollapsed(collapsed)
  }, [])

  const openMobile = useCallback(() => {
    setIsMobileOpen(true)
    clientLogger.debug('Opened mobile sidebar')
  }, [])

  const closeMobile = useCallback(() => {
    setIsMobileOpen(false)
    clientLogger.debug('Closed mobile sidebar')
  }, [])

  const value = useMemo<SidebarContextValue>(
    () => ({
      isCollapsed,
      isMobileOpen,
      toggleCollapse,
      setCollapsed,
      openMobile,
      closeMobile,
      isMobile,
    }),
    [isCollapsed, isMobileOpen, toggleCollapse, setCollapsed, openMobile, closeMobile, isMobile]
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
