'use client'

/**
 * ChatSettingsProvider
 *
 * React context that wraps the existing useChatSettings() hook,
 * allowing the settings page tabs to share a single instance
 * of chat settings state without duplicate fetches.
 *
 * @module components/settings/chat-settings/ChatSettingsProvider
 */

import { createContext, useContext, type ReactNode } from 'react'
import { useChatSettings } from './hooks/useChatSettings'

type ChatSettingsContextValue = ReturnType<typeof useChatSettings>

const ChatSettingsContext = createContext<ChatSettingsContextValue | null>(null)

/**
 * Provides chat settings state to all child components.
 * Calls useChatSettings() once and shares the result via context.
 */
export function ChatSettingsProvider({ children }: { children: ReactNode }) {
  const chatSettings = useChatSettings()

  return (
    <ChatSettingsContext.Provider value={chatSettings}>
      {children}
    </ChatSettingsContext.Provider>
  )
}

/**
 * Consume the shared chat settings context.
 * Must be used within a ChatSettingsProvider.
 */
export function useChatSettingsContext(): ChatSettingsContextValue {
  const ctx = useContext(ChatSettingsContext)
  if (!ctx) {
    throw new Error('useChatSettingsContext must be used within a ChatSettingsProvider')
  }
  return ctx
}
