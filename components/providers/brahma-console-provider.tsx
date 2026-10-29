'use client'

/**
 * Brahma Console Provider
 *
 * Provides Brahma Console state and actions to the authenticated UI. The
 * Brahma Console is a character-less, memory-free generic-LLM surface, so —
 * unlike the Help Chat provider — there is NO eligibility/character selection
 * and NO pathname tracking (the console is not page-aware).
 *
 * What lives here is what every console surface shares: whether the always-on
 * floating dialog is showing, and the connection profiles (models) to choose
 * from. Which conversation a surface is on is per surface — see
 * `useBrahmaConsoleSession`.
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
  isDefault: boolean
}

interface BrahmaConsoleContextValue {
  /** Whether the floating console dialog is open */
  isOpen: boolean
  /** Open the floating console */
  openConsole: () => void
  /** Close (hide) the floating console */
  closeConsole: () => void
  /** Open the floating console if hidden, hide it if open */
  toggleConsole: () => void
  /** All of the user's connection profiles (for the model picker) */
  profiles: BrahmaConnectionProfile[]
  /** Whether the profile list is still loading */
  profilesLoading: boolean
  /** Whether the console can converse at all (≥1 connection profile exists) */
  isEligible: boolean
}

// ============================================================================
// CONTEXT
// ============================================================================

const BrahmaConsoleContext = createContext<BrahmaConsoleContextValue | null>(null)

// ============================================================================
// PROVIDER
// ============================================================================

export function BrahmaConsoleProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const { profiles, loading: profilesLoading } = useConnectionProfiles()

  const openConsole = useCallback(() => setIsOpen(true), [])
  const closeConsole = useCallback(() => setIsOpen(false), [])
  const toggleConsole = useCallback(() => setIsOpen(open => !open), [])

  const value: BrahmaConsoleContextValue = {
    isOpen,
    openConsole,
    closeConsole,
    toggleConsole,
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
