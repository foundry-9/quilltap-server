'use client'

/**
 * Card bodies for the Appearance group.
 *
 * @module components/settings/cards/appearance-cards
 */

import { AvatarSettings } from '@/components/settings/chat-settings/AvatarSettings'
import { DynamicBackgroundsSettings } from '@/components/settings/chat-settings/DynamicBackgroundsSettings'
import { WithChatSettings } from './with-chat-settings'

export { default as AppearanceCard } from '@/components/settings/appearance'
export { default as TagsCard } from '@/components/settings/tags-tab'
export { CalliopeSettings as CalliopeCard } from '@/components/settings/calliope/CalliopeSettings'

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

export function DynamicBackgroundsCard() {
  return (
    <WithChatSettings>
      {({ settings, saving, handleDynamicBackgroundsChange }) => (
        <DynamicBackgroundsSettings
          settings={settings}
          saving={saving}
          onChange={handleDynamicBackgroundsChange}
        />
      )}
    </WithChatSettings>
  )
}
