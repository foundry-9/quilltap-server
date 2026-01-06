'use client'

/**
 * Page Toolbar Provider
 *
 * Allows child pages to inject content into the PageToolbar's left and right sections.
 * Used for contextual navigation like project links in chat pages,
 * and contextual info like token/cost summaries.
 *
 * @module components/providers/page-toolbar-provider
 */

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface PageToolbarContextValue {
  leftContent: ReactNode | null
  setLeftContent: (content: ReactNode | null) => void
  rightContent: ReactNode | null
  setRightContent: (content: ReactNode | null) => void
}

const PageToolbarContext = createContext<PageToolbarContextValue | null>(null)

export function PageToolbarProvider({ children }: { children: ReactNode }) {
  const [leftContent, setLeftContentState] = useState<ReactNode | null>(null)
  const [rightContent, setRightContentState] = useState<ReactNode | null>(null)

  const setLeftContent = useCallback((content: ReactNode | null) => {
    setLeftContentState(content)
  }, [])

  const setRightContent = useCallback((content: ReactNode | null) => {
    setRightContentState(content)
  }, [])

  return (
    <PageToolbarContext.Provider value={{ leftContent, setLeftContent, rightContent, setRightContent }}>
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
