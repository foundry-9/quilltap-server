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
  /** Current page URL for context */
  currentPageUrl: string
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
  const previousPathname = useRef(pathname)

  // Fetch eligibility on mount
  const fetchEligibility = useCallback(async () => {
    try {
      setEligibilityLoading(true)
      const res = await fetch('/api/v1/help-chats?action=eligibility')
      if (res.ok) {
        const data = await res.json()
        setEligibleCharacters(data.characters || [])

        // Auto-select first eligible character if none selected
        const eligible = (data.characters || []).filter(
          (c: HelpChatEligibleCharacter) => c.hasToolCapableProfile
        )
        if (selectedCharacterIds.length === 0 && eligible.length > 0) {
          const autoSelected = [eligible[0].id]
          setSelectedCharacterIds(autoSelected)
          saveStorageValue(STORAGE_KEY_SELECTED, autoSelected)
        }
      }
    } catch (error) {
      console.error('Failed to fetch help chat eligibility:', error)
    } finally {
      setEligibilityLoading(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchEligibility()
  }, [fetchEligibility])

  // Track pathname changes for context updates
  useEffect(() => {
    if (pathname !== previousPathname.current) {
      previousPathname.current = pathname

      // If chat is open, update context
      if (isOpen && currentChatId) {
        fetch(`/api/v1/help-chats/${currentChatId}?action=update-context`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pageUrl: pathname }),
        }).catch(error => {
          console.error('Failed to update help chat context:', error)
        })
      }
    }
  }, [pathname, isOpen, currentChatId])

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
    currentPageUrl: pathname,
    refreshEligibility: fetchEligibility,
  }

  return (
    <HelpChatContext.Provider value={value}>
      {children}
    </HelpChatContext.Provider>
  )
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
