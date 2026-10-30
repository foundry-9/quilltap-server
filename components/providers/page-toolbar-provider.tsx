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
import type { ConversationSearchSource } from '@/lib/chat/conversation-search'

export interface PageToolbarContextValue {
  leftContent: ReactNode | null
  setLeftContent: (content: ReactNode | null) => void
  rightContent: ReactNode | null
  setRightContent: (content: ReactNode | null) => void
  /**
   * The open conversation the header search bar looks inside first — set by
   * the Salon, null everywhere else. Follows tab focus like the slots above.
   */
  conversationSearch: ConversationSearchSource | null
  setConversationSearch: (source: ConversationSearchSource | null) => void
}

/**
 * Exported so the per-tab `TabToolbarProvider` (tabbed workspace) can supply the
 * *same* context. `usePageToolbar()` then resolves to whichever provider is
 * nearest — the per-tab one inside a workspace tab, the global one on the
 * legacy routes — with no change to the call sites.
 */
export const PageToolbarContext = createContext<PageToolbarContextValue | null>(null)

export function PageToolbarProvider({ children }: { children: ReactNode }) {
  const [leftContent, setLeftContentState] = useState<ReactNode | null>(null)
  const [rightContent, setRightContentState] = useState<ReactNode | null>(null)
  const [conversationSearch, setConversationSearchState] = useState<ConversationSearchSource | null>(null)

  const setLeftContent = useCallback((content: ReactNode | null) => {
    setLeftContentState(content)
  }, [])

  const setRightContent = useCallback((content: ReactNode | null) => {
    setRightContentState(content)
  }, [])

  const setConversationSearch = useCallback((source: ConversationSearchSource | null) => {
    setConversationSearchState(() => source)
  }, [])

  return (
    <PageToolbarContext.Provider
      value={{ leftContent, setLeftContent, rightContent, setRightContent, conversationSearch, setConversationSearch }}
    >
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
