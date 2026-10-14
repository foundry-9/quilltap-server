'use client'

import type {
  ConciergeSettings,
  ConciergeSettingsUpdate,
} from '@/components/settings/chat-settings/types'

export interface RefusalsCardProps {
  settings: ConciergeSettings
  saving: boolean
  onUpdate: (updates: ConciergeSettingsUpdate) => Promise<void>
}

const NEW_CHAT_STATE_OPTIONS: { value: ConciergeSettings['newChatsStartAs']; label: string; description: string }[] = [
  {
    value: 'moderated',
    label: 'Moderated',
    description: 'New chats go to their own provider first; the Concierge steps in only when it refuses.',
  },
  {
    value: 'unmoderated',
    label: 'Unmoderated',
    description: 'New chats go straight to the uncensored desk from the first message.',
  },
]

/**
 * What the Concierge does after refusals, and the state a new chat starts in
 * when the New Chat form names none.
 */
export function RefusalsCard({ settings, saving, onUpdate }: RefusalsCardProps) {
  const selectedState = NEW_CHAT_STATE_OPTIONS.find((o) => o.value === settings.newChatsStartAs)

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label htmlFor="concierge-auto-switch-after-refusals" className="block qt-text-label">
          Switch a chat to Unmoderated after this many refusals (0 = never)
        </label>
        <input
          id="concierge-auto-switch-after-refusals"
          type="number"
          min={0}
          max={10}
          step={1}
          value={settings.autoSwitchAfterRefusals}
          onChange={(e) => {
            const parsed = parseInt(e.target.value, 10)
            if (Number.isNaN(parsed)) return
            onUpdate({ autoSwitchAfterRefusals: Math.min(10, Math.max(0, parsed)) })
          }}
          disabled={saving}
          className="qt-input w-24"
        />
        <p className="qt-text-small">
          Counts only refusals a provider actually states on a Moderated chat. When the tally is reached the
          Concierge moves the whole chat to Unmoderated and says so; returning the chat to Moderated clears it.
          Locked chats are never switched.
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="concierge-new-chats-start-as" className="block qt-text-label">
          New chats start as
        </label>
        <select
          id="concierge-new-chats-start-as"
          value={settings.newChatsStartAs}
          onChange={(e) => onUpdate({ newChatsStartAs: e.target.value as ConciergeSettings['newChatsStartAs'] })}
          disabled={saving}
          className="qt-select"
        >
          {NEW_CHAT_STATE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {selectedState && <p className="qt-text-small">{selectedState.description}</p>}
      </div>
    </div>
  )
}
