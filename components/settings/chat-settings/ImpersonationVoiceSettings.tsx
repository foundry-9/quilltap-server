'use client'

import type { ChatSettings } from './types'
import { SettingsToggleRow } from './components/SettingsToggleRow'

export interface ImpersonationVoiceSettingsProps {
  settings: ChatSettings
  saving: boolean
  onChange: (value: boolean) => Promise<void>
}

export function ImpersonationVoiceSettings({
  settings,
  saving,
  onChange,
}: ImpersonationVoiceSettingsProps) {
  const enabled = settings.impersonationVoiceRewrite ?? false

  return (
    <SettingsToggleRow
      checked={enabled}
      disabled={saving}
      onChange={onChange}
      heading="Impersonated lines in the character's own words"
    >
      When you have taken a character&apos;s seat with the Impersonate button, your draft
      is handed first to that character — their own model, their own voice — and returned
      for your inspection before a syllable reaches the room. Send the restatement, have
      it attempted afresh, retire to the composer and rewrite, or send your own words
      exactly as typed. Nothing posts until you say so. Speaking as yourself is untouched,
      as are sends that carry only attachments or tool results.
    </SettingsToggleRow>
  )
}
