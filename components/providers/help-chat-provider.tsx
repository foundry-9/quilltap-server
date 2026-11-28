'use client'

/**
 * Help Chat Provider
 *
 * Provides help chat state and actions to the entire authenticated UI.
 * Manages eligibility checking, chat lifecycle, and page navigation context.
 *
 * @module components/providers/help-chat-provider
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react'
import { usePathname } from 'next/navigation'
import { useWorkspaceOptional } from '@/components/providers/workspace-provider'
import { hrefForTabIntent } from '@/lib/navigation/route-to-intent'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'

// ============================================================================
// TYPES
// ============================================================================

export interface HelpChatEligibleCharacter {
  id: string
  name: string
  avatarUrl: string | null
  defaultHelpToolsEnabled: boolean
  connectionProfileId: string | null
  hasToolCapableProfile: boolean
}

interface HelpChatContextValue {
  /** Whether the help chat dialog is open */
  isOpen: boolean
  /** Open the help chat dialog */
  openHelpChat: () => void
  /** Close the help chat dialog */
  closeHelpChat: () => void
  /** Currently active help chat ID */
  currentChatId: string | null
  /** Set the current chat ID */
  setCurrentChatId: (id: string | null) => void
  /** Eligible characters for help chats */
  eligibleCharacters: HelpChatEligibleCharacter[]
  /** Whether any eligible characters exist */
  isEligible: boolean
  /** Whether eligibility is still loading */
  eligibilityLoading: boolean
  /** Selected character IDs for new chats */
  selectedCharacterIds: string[]
  /** Toggle character selection */
  toggleCharacter: (characterId: string) => void
  /**
   * The page the user is on, as a help URL: inside the workspace (whose
   * pathname never changes) the focused pane's active tab, else the pathname
   * (#247).
   */
  currentPageUrl: string
  /**
   * Report the workspace's focused tab as an in-app href (null when there is
   * none). Called only by {@link HelpChatWorkspaceBridge}.
   */
  reportWorkspacePageUrl: (href: string | null) => void
  /** Refresh eligibility data */
  refreshEligibility: () => Promise<void>
}

// ============================================================================
// CONTEXT
// ============================================================================

const HelpChatContext = createContext<HelpChatContextValue | null>(null)

// ============================================================================
// LOCAL STORAGE HELPERS
// ============================================================================

const STORAGE_KEY_SELECTED = 'quilltap:help-chat-selected-characters'
const STORAGE_KEY_LAST_CHAT = 'quilltap:help-chat-last-id'

function loadStorageArray(key: string): string[] {
  try {
    const val = localStorage.getItem(key)
    if (val) return JSON.parse(val)
  } catch { /* ignore */ }
  return []
}

function saveStorageValue(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch { /* ignore */ }
}

// ============================================================================
// PROVIDER
// ============================================================================

export function HelpChatProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)
  const [currentChatId, setCurrentChatId] = useState<string | null>(() => {
    try {
      let val = localStorage.getItem(STORAGE_KEY_LAST_CHAT) || null
      // Clean up legacy double-quoted values from prior JSON.stringify bug
      if (val && val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1)
        localStorage.setItem(STORAGE_KEY_LAST_CHAT, val)
      }
      return val
    } catch { return null }
  })
  const [eligibleCharacters, setEligibleCharacters] = useState<HelpChatEligibleCharacter[]>([])
  const [eligibilityLoading, setEligibilityLoading] = useState(true)
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>(() =>
    loadStorageArray(STORAGE_KEY_SELECTED)
  )
  const [workspacePageUrl, setWorkspacePageUrl] = useState<string | null>(null)
  const currentPageUrl = isWorkspacePath(pathname) && workspacePageUrl ? workspacePageUrl : pathname
  const previousPageUrl = useRef(currentPageUrl)

  const { data: eligibilityData, isPending: eligibilityIsLoading, refetch: mutateEligibility } = useQuery({
    queryKey: queryKeys.helpChat.eligibility,
    queryFn: ({ signal }) => apiFetch<{ characters: HelpChatEligibleCharacter[] }>('/api/v1/help-chats?action=eligibility', { signal }),
  })

  // Update state from Query data
  useEffect(() => {
    if (eligibilityData?.characters) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Query data must sync to local state that's also mutated by action handlers (filter/delete/update)
      setEligibleCharacters(eligibilityData.characters)

      // Auto-select first eligible character if none selected
      const eligible = eligibilityData.characters.filter(
        (c: HelpChatEligibleCharacter) => c.hasToolCapableProfile
      )
      if (selectedCharacterIds.length === 0 && eligible.length > 0) {
        const autoSelected = [eligible[0].id]
        setSelectedCharacterIds(autoSelected)
        saveStorageValue(STORAGE_KEY_SELECTED, autoSelected)
      }
    }
    setEligibilityLoading(eligibilityIsLoading)
  }, [eligibilityData, eligibilityIsLoading, selectedCharacterIds.length])

  // Track page changes for context updates — a route change, or a tab switch
  // inside the workspace, which never changes the pathname (#247).
  useEffect(() => {
    if (currentPageUrl !== previousPageUrl.current) {
      previousPageUrl.current = currentPageUrl

      // If chat is open, update context
      if (isOpen && currentChatId) {
        console.debug('[HelpChat] Page changed with a help chat open; updating its context', { pageUrl: currentPageUrl })
        fetch(`/api/v1/help-chats/${currentChatId}?action=update-context`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pageUrl: currentPageUrl }),
        }).catch(error => {
          console.error('Failed to update help chat context:', error)
        })
      }
    }
  }, [currentPageUrl, isOpen, currentChatId])

  const reportWorkspacePageUrl = useCallback((href: string | null) => {
    setWorkspacePageUrl(href)
  }, [])

  const openHelpChat = useCallback(() => {
    // Always open to the launcher view so past chats are visible
    setCurrentChatId(null)
    setIsOpen(true)
  }, [])

  const closeHelpChat = useCallback(() => {
    setIsOpen(false)
  }, [])

  const handleSetCurrentChatId = useCallback((id: string | null) => {
    setCurrentChatId(id)
    if (id) {
      // Store as plain string — not JSON-stringified — since getItem reads it back directly
      try { localStorage.setItem(STORAGE_KEY_LAST_CHAT, id) } catch { /* ignore */ }
    } else {
      try { localStorage.removeItem(STORAGE_KEY_LAST_CHAT) } catch { /* ignore */ }
    }
  }, [])

  const toggleCharacter = useCallback((characterId: string) => {
    setSelectedCharacterIds(prev => {
      const next = prev.includes(characterId)
        ? prev.filter(id => id !== characterId)
        : [...prev, characterId]
      saveStorageValue(STORAGE_KEY_SELECTED, next)
      return next
    })
  }, [])

  const isEligible = eligibleCharacters.some(c => c.hasToolCapableProfile)

  const value: HelpChatContextValue = {
    isOpen,
    openHelpChat,
    closeHelpChat,
    currentChatId,
    setCurrentChatId: handleSetCurrentChatId,
    eligibleCharacters,
    isEligible,
    eligibilityLoading,
    selectedCharacterIds,
    toggleCharacter,
    currentPageUrl,
    reportWorkspacePageUrl,
    refreshEligibility: async () => { await mutateEligibility() },
  }

  return (
    <HelpChatContext.Provider value={value}>
      {children}
    </HelpChatContext.Provider>
  )
}

/** Whether `pathname` is the workspace shell, where tabs (not routes) say which page is shown. */
function isWorkspacePath(pathname: string | null): boolean {
  return pathname === '/workspace' || (pathname?.startsWith('/workspace/') ?? false)
}

/**
 * Renderless: tells the help chat which page the workspace is showing — the
 * focused pane's active tab, as the href that tab stands for. Mounted inside
 * the workspace providers, which sit below {@link HelpChatProvider}.
 */
export function HelpChatWorkspaceBridge(): null {
  const workspace = useWorkspaceOptional()
  const helpChat = useContext(HelpChatContext)
  const report = helpChat?.reportWorkspacePageUrl

  let href: string | null = null
  if (workspace?.hydrated) {
    const { state } = workspace
    const activeTabId = state.panes[state.focusedPane]?.activeTabId ?? null
    const tab = activeTabId ? state.tabs[activeTabId] : undefined
    if (tab) href = hrefForTabIntent(tab.kind, tab.payload)
  }

  useEffect(() => {
    report?.(href)
  }, [report, href])

  useEffect(() => () => report?.(null), [report])

  return null
}

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Hook to access help chat context
 */
export function useHelpChat(): HelpChatContextValue {
  const context = useContext(HelpChatContext)
  if (!context) {
    throw new Error('useHelpChat must be used within HelpChatProvider')
  }
  return context
}

/**
 * Optional hook — returns null if not in provider
 * Useful for components that might be rendered outside the provider
 */
export function useHelpChatOptional(): HelpChatContextValue | null {
  return useContext(HelpChatContext)
}
