'use client'

import type { ChatSettings, ImpersonationVoiceMode } from './types'

export interface ImpersonationVoiceSettingsProps {
  settings: ChatSettings
  saving: boolean
  onChange: (value: ImpersonationVoiceMode) => Promise<void>
}

const MODES: ReadonlyArray<{ value: ImpersonationVoiceMode; label: string; description: string }> = [
  {
    value: 'off',
    label: 'Never',
    description: 'Your line goes straight to the room, exactly as typed. No dialog, no rehearsal.',
  },
  {
    value: 'ask',
    label: 'Ask each time',
    description:
      'The dialog opens with your draft and nothing more — no model is troubled. Send it as written, '
      + 'or ask the character to restate it in their own voice.',
  },
  {
    value: 'always',
    label: 'Always restate',
    description:
      'The dialog opens and the character begins restating your draft at once. You may still send '
      + 'your own words as written.',
  },
]

export function ImpersonationVoiceSettings({
  settings,
  saving,
  onChange,
}: ImpersonationVoiceSettingsProps) {
  const mode = settings.impersonationVoiceMode ?? 'off'

  return (
    <fieldset>
      <legend className="qt-settings-section-heading">
        Impersonated lines in the character&apos;s own words
      </legend>
      <div className="qt-text-small mt-1">
        When you have taken a character&apos;s seat with the Impersonate button, your draft may
        be handed first to that character — their own model, their own voice — and returned for
        your inspection before a syllable reaches the room. Nothing posts until you say so.
        Speaking as yourself is untouched, as are sends that carry only attachments or tool results.
      </div>
      <div className="mt-3 space-y-2">
        {MODES.map((m) => (
          <label key={m.value} className="qt-settings-toggle-row">
            <input
              type="radio"
              name="impersonationVoiceMode"
              value={m.value}
              checked={mode === m.value}
              onChange={() => onChange(m.value)}
              disabled={saving}
              className="qt-radio mt-1"
            />
            <div className="flex-1">
              <div className="font-medium">{m.label}</div>
              <div className="qt-text-small mt-1">{m.description}</div>
            </div>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
