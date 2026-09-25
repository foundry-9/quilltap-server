'use client'

import { SettingsToggleRow } from '@/components/settings/chat-settings/components/SettingsToggleRow'
import type { ConciergeSettings, ConciergeSettingsUpdate } from '@/components/settings/chat-settings/types'

export interface OnDutyCardProps {
  settings: ConciergeSettings
  saving: boolean
  onUpdate: (updates: ConciergeSettingsUpdate) => Promise<void>
}

/**
 * The Concierge's master switch. Off means he does nothing at all: no
 * failover, no announcements, no auto-switch, no pre-screen — and every
 * chat's Moderated / Unmoderated / Locked select is disabled until he
 * returns.
 */
export function OnDutyCard({ settings, saving, onUpdate }: OnDutyCardProps) {
  return (
    <div className="space-y-3">
      <SettingsToggleRow
        checked={settings.enabled}
        disabled={saving}
        onChange={(value) => onUpdate({ enabled: value })}
        heading="The Concierge is on duty"
      >
        When a provider declines a Moderated chat, the Concierge carries the request to the uncensored desk,
        says so in the chat, and may move the chat to Unmoderated after repeated refusals. Turn him off and
        nothing is rerouted, announced, switched or screened; every chat is answered by its own provider
        alone, and the per-chat Concierge select is disabled.
      </SettingsToggleRow>
    </div>
  )
}
