'use client'

import type { ChatSettings } from './types'

export interface ComposerSpellcheckSettingsProps {
  settings: ChatSettings
  saving: boolean
  onChange: (value: boolean) => Promise<void>
}

export function ComposerSpellcheckSettings({
  settings,
  saving,
  onChange,
}: ComposerSpellcheckSettingsProps) {
  const enabled = settings.composerSpellcheck ?? true

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
            Spellcheck in the composer
          </div>
          <div className="qt-text-small mt-1">
            Underlines misspelled words in the Salon composer and the Document Mode editor.
            In the Quilltap desktop app, right-click a flagged word to see suggestions and
            add it to your dictionary. Source-mode editors (raw Markdown, plain text) stay
            unsquiggled regardless.
          </div>
        </div>
      </label>
    </div>
  )
}
