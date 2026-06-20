'use client'

/**
 * Brahma Console Provider
 *
 * Provides Brahma Console state and actions to the authenticated UI. The
 * Brahma Console is a character-less, memory-free generic-LLM surface, so —
 * unlike the Help Chat provider — there is NO eligibility/character selection
 * and NO pathname tracking (the console is not page-aware). What it adds is the
 * active connection profile (model), switchable at any time, continuing the
 * same chat.
 *
 * @module components/providers/brahma-console-provider
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react'
import { useConnectionProfiles } from '@/hooks/useConnectionProfiles'

// ============================================================================
// TYPES
// ============================================================================

export interface BrahmaConnectionProfile {
  id: string
  name: string
  provider: string
  modelName: string
}

interface BrahmaConsoleContextValue {
  /** Whether the console dialog is open */
  isOpen: boolean
  /** Open the console (to the past-chats launcher view) */
  openConsole: () => void
  /** Close the console */
  closeConsole: () => void
  /** Currently active console chat ID */
  currentChatId: string | null
  /** Set the current chat ID (persists to localStorage) */
  setCurrentChatId: (id: string | null) => void
  /** The connection profile (model) the open chat is currently talking to */
  activeConnectionProfileId: string | null
  /** Set the active model locally (e.g. when a chat loads) — does NOT PATCH */
  setActiveConnectionProfileId: (id: string | null) => void
  /**
   * Switch the model for the current chat. PATCHes `?action=set-model` so the
   * same chat continues with the new engine, then updates local state.
   */
  setModel: (connectionProfileId: string) => Promise<void>
  /** All of the user's connection profiles (for the model picker) */
  profiles: BrahmaConnectionProfile[]
  /** Whether the profile list is still loading */
  profilesLoading: boolean
  /** Whether the console can be opened at all (≥1 connection profile exists) */
  isEligible: boolean
}

// ============================================================================
// CONTEXT
// ============================================================================

const BrahmaConsoleContext = createContext<BrahmaConsoleContextValue | null>(null)

// ============================================================================
// LOCAL STORAGE
// ============================================================================

const STORAGE_KEY_LAST_CHAT = 'quilltap:brahma-console-last-id'

// ============================================================================
// PROVIDER
// ============================================================================

export function BrahmaConsoleProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [currentChatId, setCurrentChatIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_LAST_CHAT) || null
    } catch {
      return null
    }
  })
  const [activeConnectionProfileId, setActiveConnectionProfileId] = useState<string | null>(null)

  const { profiles, loading: profilesLoading } = useConnectionProfiles()

  const openConsole = useCallback(() => {
    // Always open to the launcher view so past chats are visible
    setCurrentChatIdState(null)
    setIsOpen(true)
  }, [])

  const closeConsole = useCallback(() => {
    setIsOpen(false)
  }, [])

  const setCurrentChatId = useCallback((id: string | null) => {
    setCurrentChatIdState(id)
    try {
      if (id) localStorage.setItem(STORAGE_KEY_LAST_CHAT, id)
      else localStorage.removeItem(STORAGE_KEY_LAST_CHAT)
    } catch { /* ignore */ }
  }, [])

  const setModel = useCallback(async (connectionProfileId: string) => {
    // Optimistically reflect the switch; the same chat continues.
    setActiveConnectionProfileId(connectionProfileId)
    if (!currentChatId) return
    try {
      await fetch(`/api/v1/brahma-console/${currentChatId}?action=set-model`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionProfileId }),
      })
    } catch (error) {
      console.error('Failed to switch Brahma Console model:', error)
    }
  }, [currentChatId])

  const value: BrahmaConsoleContextValue = {
    isOpen,
    openConsole,
    closeConsole,
    currentChatId,
    setCurrentChatId,
    activeConnectionProfileId,
    setActiveConnectionProfileId,
    setModel,
    profiles,
    profilesLoading,
    isEligible: profiles.length > 0,
  }

  return (
    <BrahmaConsoleContext.Provider value={value}>
      {children}
    </BrahmaConsoleContext.Provider>
  )
}

// ============================================================================
// HOOKS
// ============================================================================

export function useBrahmaConsole(): BrahmaConsoleContextValue {
  const context = useContext(BrahmaConsoleContext)
  if (!context) {
    throw new Error('useBrahmaConsole must be used within BrahmaConsoleProvider')
  }
  return context
}

/** Optional hook — returns null if not in provider. */
export function useBrahmaConsoleOptional(): BrahmaConsoleContextValue | null {
  return useContext(BrahmaConsoleContext)
}
