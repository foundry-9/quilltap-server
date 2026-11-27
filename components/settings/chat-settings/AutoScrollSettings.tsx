'use client'

import { DEFAULT_AUTO_SCROLL_ON_RESPONSE_COMPLETE, type ChatSettings } from './types'
import { SettingsToggleRow } from './components/SettingsToggleRow'

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
  const enabled = settings.autoScrollOnResponseComplete ?? DEFAULT_AUTO_SCROLL_ON_RESPONSE_COMPLETE

  return (
    <SettingsToggleRow
      checked={enabled}
      disabled={saving}
      onChange={onChange}
      heading="Chase each reply to its end"
    >
      When the parlour falls quiet at the close of a reply, this whisks you down to the
      very last word. Left unchecked (the default), the Salon holds its position so a
      lengthy soliloquy can&apos;t spirit your place away mid-read; a discreet
      &ldquo;jump to latest&rdquo; button appears whenever you&apos;ve wandered up the
      page. Sending a message of your own, and first opening a chat, always settle you
      at the bottom regardless.
    </SettingsToggleRow>
  )
}
