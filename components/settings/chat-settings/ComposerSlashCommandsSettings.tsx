'use client'

import type { ChatSettings } from './types'
import { SettingsToggleRow } from './components/SettingsToggleRow'

export interface ComposerSlashCommandsSettingsProps {
  settings: ChatSettings
  saving: boolean
  onChange: (value: boolean) => Promise<void>
}

export function ComposerSlashCommandsSettings({
  settings,
  saving,
  onChange,
}: ComposerSlashCommandsSettingsProps) {
  const enabled = settings.composerSlashCommands ?? true

  return (
    <SettingsToggleRow
      checked={enabled}
      disabled={saving}
      onChange={onChange}
      heading="Slash commands"
    >
      Type <code>/</code> at the start of a word to run a tool or open a composer action. The
      gutter buttons and the sidebar are never affected.
    </SettingsToggleRow>
  )
}
