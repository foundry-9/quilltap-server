'use client'

/**
 * Content Width Provider
 *
 * Manages the content width preference (narrow vs wide) for single-column layouts.
 * Persists preference to localStorage and injects CSS variable.
 *
 * @module components/providers/content-width-provider
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { booleanCodec, usePersistentState } from '@/hooks/usePersistentState'

interface ContentWidthContextValue {
  /** Whether wide mode is enabled */
  isWide: boolean
  /** Whether the viewport is large enough for wide mode to apply (>= 1000px) */
  canApplyWide: boolean
  /** Toggle between narrow and wide modes */
  toggleWidth: () => void
  /** Set width mode explicitly */
  setWidth: (wide: boolean) => void
}

const STORAGE_KEY = 'quilltap.contentWidth.isWide'
const WIDE_VIEWPORT_MIN = 1000
const NARROW_WIDTH = '900px'
const WIDE_WIDTH = '100%'
const NARROW_PAGE_WIDTH = '75rem'
const WIDE_PAGE_WIDTH = '100%'

const ContentWidthContext = createContext<ContentWidthContextValue | null>(null)

export function ContentWidthProvider({ children }: { children: React.ReactNode }) {
  // Read after hydration, written back on change, synced across tabs.
  const [isWide, setIsWide] = usePersistentState(STORAGE_KEY, false, booleanCodec)
  const [canApplyWide, setCanApplyWide] = useState(false)

  // Track viewport width to determine if wide mode can apply
  useEffect(() => {
    if (typeof window === 'undefined') return

    const mediaQuery = window.matchMedia(`(min-width: ${WIDE_VIEWPORT_MIN}px)`)

    const updateCanApply = () => {
      setCanApplyWide(mediaQuery.matches)
    }

    updateCanApply()
    mediaQuery.addEventListener('change', updateCanApply)
    return () => mediaQuery.removeEventListener('change', updateCanApply)
  }, [])

  // Apply CSS variables and data attribute based on preference and viewport
  useEffect(() => {
    if (typeof window === 'undefined') return
    const root = document.documentElement

    const shouldApplyWide = isWide && canApplyWide
    const chatWidth = shouldApplyWide ? WIDE_WIDTH : NARROW_WIDTH
    const pageWidth = shouldApplyWide ? WIDE_PAGE_WIDTH : NARROW_PAGE_WIDTH

    root.style.setProperty('--qt-chat-message-row-max-width', chatWidth)
    root.style.setProperty('--qt-page-max-width', pageWidth)

    // Set data attribute for CSS selectors that need to know about full-width mode
    if (shouldApplyWide) {
      root.setAttribute('data-full-width', 'true')
    } else {
      root.removeAttribute('data-full-width')
    }
  }, [isWide, canApplyWide])

  const toggleWidth = useCallback(() => {
    setIsWide(prev => !prev)
  }, [setIsWide])

  const setWidth = useCallback((wide: boolean) => {
    setIsWide(wide)
  }, [setIsWide])

  const value = useMemo<ContentWidthContextValue>(
    () => ({
      isWide,
      canApplyWide,
      toggleWidth,
      setWidth,
    }),
    [isWide, canApplyWide, toggleWidth, setWidth]
  )

  return (
    <ContentWidthContext.Provider value={value}>
      {children}
    </ContentWidthContext.Provider>
  )
}

export function useContentWidth() {
  const ctx = useContext(ContentWidthContext)
  if (!ctx) {
    throw new Error('useContentWidth must be used within a ContentWidthProvider')
  }
  return ctx
}

/**
 * Optional hook that returns null if used outside provider context.
 * Useful for components that may be rendered before provider is mounted.
 */
export function useContentWidthOptional() {
  return useContext(ContentWidthContext)
}
