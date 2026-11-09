'use client'

/**
 * The loading / failed branches every chat-settings-backed card shares.
 * The settings row and profile lists come from the page's one
 * `ChatSettingsProvider`, so a card never fetches them itself.
 *
 * @module components/settings/cards/with-chat-settings
 */

import type { ReactNode } from 'react'
import { useChatSettingsContext } from '@/components/settings/chat-settings/ChatSettingsProvider'

type ChatSettingsContextValue = ReturnType<typeof useChatSettingsContext>
export type LoadedChatSettings = ChatSettingsContextValue & {
  settings: NonNullable<ChatSettingsContextValue['settings']>
}

export function WithChatSettings({
  children,
  failure = 'Failed to load settings',
}: {
  children: (ctx: LoadedChatSettings) => ReactNode
  failure?: string
}) {
  const ctx = useChatSettingsContext()
  if (ctx.loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="qt-text-secondary">Loading settings...</div>
      </div>
    )
  }
  if (!ctx.settings) {
    return <div className="qt-alert-error">{failure}</div>
  }
  return <>{children(ctx as LoadedChatSettings)}</>
}
