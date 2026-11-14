'use client'

/**
 * Card bodies for the Appearance group.
 *
 * @module components/settings/cards/appearance-cards
 */

import { AvatarSettings } from '@/components/settings/chat-settings/AvatarSettings'
import { WithChatSettings } from './with-chat-settings'

export { default as AppearanceCard } from '@/components/settings/appearance-tab'
export { default as TagsCard } from '@/components/settings/tags-tab'

export function AvatarSettingsCard() {
  return (
    <WithChatSettings>
      {({ settings, saving, handleAvatarModeChange, handleAvatarStyleChange }) => (
        <AvatarSettings
          settings={settings}
          saving={saving}
          onAvatarModeChange={handleAvatarModeChange}
          onAvatarStyleChange={handleAvatarStyleChange}
        />
      )}
    </WithChatSettings>
  )
}
