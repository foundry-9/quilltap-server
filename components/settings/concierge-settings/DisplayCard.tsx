'use client'

import { SettingsToggleRow } from '@/components/settings/chat-settings/components/SettingsToggleRow'
import type {
  ConciergeSettings,
  ConciergeSettingsUpdate,
} from '@/components/settings/chat-settings/types'

export interface DisplayCardProps {
  settings: ConciergeSettings
  saving: boolean
  onUpdate: (updates: ConciergeSettingsUpdate) => Promise<void>
}

type DisplayMode = ConciergeSettings['display']['mode']

const DISPLAY_MODE_OPTIONS: { value: DisplayMode; label: string; description: string }[] = [
  { value: 'SHOW', label: 'Show', description: 'Flagged content is shown normally.' },
  { value: 'BLUR', label: 'Blur', description: 'Flagged content is blurred until you click to reveal it.' },
  { value: 'COLLAPSE', label: 'Collapse', description: 'Flagged content is folded away behind a placeholder.' },
]

/**
 * How flagged or Unmoderated content looks in the Salon. Only consulted
 * while the Concierge is on duty; off duty, everything is shown plainly.
 */
export function DisplayCard({ settings, saving, onUpdate }: DisplayCardProps) {
  const selectedMode = DISPLAY_MODE_OPTIONS.find((o) => o.value === settings.display.mode)

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label htmlFor="concierge-display-mode" className="block qt-text-label">
          Flagged content
        </label>
        <select
          id="concierge-display-mode"
          value={settings.display.mode}
          onChange={(e) => onUpdate({ display: { mode: e.target.value as DisplayMode } })}
          disabled={saving}
          className="qt-select"
        >
          {DISPLAY_MODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {selectedMode && <p className="qt-text-small">{selectedMode.description}</p>}
      </div>

      <SettingsToggleRow
        checked={settings.display.showWarningBadges}
        disabled={saving}
        onChange={(value) => onUpdate({ display: { showWarningBadges: value } })}
        heading="Show warning badges"
      >
        Display category badges on flagged messages.
      </SettingsToggleRow>
    </div>
  )
}
