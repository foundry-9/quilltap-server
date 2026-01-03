'use client'

/**
 * Page Toolbar Provider
 *
 * Allows child pages to inject content into the PageToolbar's left section.
 * Used for contextual navigation like project links in chat pages.
 *
 * @module components/providers/page-toolbar-provider
 */

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface PageToolbarContextValue {
  leftContent: ReactNode | null
  setLeftContent: (content: ReactNode | null) => void
}

const PageToolbarContext = createContext<PageToolbarContextValue | null>(null)

export function PageToolbarProvider({ children }: { children: ReactNode }) {
  const [leftContent, setLeftContentState] = useState<ReactNode | null>(null)

  const setLeftContent = useCallback((content: ReactNode | null) => {
    setLeftContentState(content)
  }, [])

  return (
    <PageToolbarContext.Provider value={{ leftContent, setLeftContent }}>
      {children}
    </PageToolbarContext.Provider>
  )
}

export function usePageToolbar() {
  const context = useContext(PageToolbarContext)
  if (!context) {
    throw new Error('usePageToolbar must be used within a PageToolbarProvider')
  }
  return context
}

export function usePageToolbarOptional() {
  return useContext(PageToolbarContext)
}
