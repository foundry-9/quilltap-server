'use client'

import type { ChatSettings } from './types'

export interface CompositionModeDefaultSettingsProps {
  settings: ChatSettings
  saving: boolean
  onChange: (value: boolean) => Promise<void>
}

export function CompositionModeDefaultSettings({
  settings,
  saving,
  onChange,
}: CompositionModeDefaultSettingsProps) {
  const enabled = settings.compositionModeDefault ?? false

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
            Start New Chats in Composition Mode
          </div>
          <div className="qt-text-small mt-1">
            When enabled, new chats begin in composition mode: Enter inserts a newline and
            Ctrl/Cmd+Enter sends. When disabled, new chats begin in chat mode: Enter sends and
            Shift+Enter inserts a newline. You can still toggle composition mode per-chat from
            the composer toolbar.
          </div>
        </div>
      </label>
    </div>
  )
}
