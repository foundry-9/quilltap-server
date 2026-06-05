'use client'

import type { ChatSettings } from './types'

export interface AutoScrollSettingsProps {
  settings: ChatSettings
  saving: boolean
  onChange: (value: boolean) => Promise<void>
}

export function AutoScrollSettings({
  settings,
  saving,
  onChange,
}: AutoScrollSettingsProps) {
  const enabled = settings.autoScrollOnResponseComplete ?? false

  return (
    <div>
      <label className="qt-settings-toggle-row">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked)}
          disabled={saving}
          className="qt-checkbox mt-1"
        />
        <div className="flex-1">
          <div className="qt-settings-section-heading">
            Chase each reply to its end
          </div>
          <div className="qt-text-small mt-1">
            When the parlour falls quiet at the close of a reply, this whisks you down to the
            very last word. Left unchecked (the default), the Salon holds its position so a
            lengthy soliloquy can&apos;t spirit your place away mid-read; a discreet
            &ldquo;jump to latest&rdquo; button appears whenever you&apos;ve wandered up the
            page. Sending a message of your own, and first opening a chat, always settle you
            at the bottom regardless.
          </div>
        </div>
      </label>
    </div>
  )
}
