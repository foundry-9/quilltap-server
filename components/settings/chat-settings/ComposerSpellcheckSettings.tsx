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
      <label className="flex items-start gap-3 p-4 border qt-border-default rounded hover:bg-accent cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked)}
          disabled={saving}
          className="mt-1 h-4 w-4 rounded border-input text-primary focus:ring-primary"
        />
        <div className="flex-1">
          <div className="font-medium text-foreground">
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
