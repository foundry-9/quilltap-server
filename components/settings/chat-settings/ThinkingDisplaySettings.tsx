'use client'

import { SettingsCard } from '@/components/ui/SettingsCard'
import {
  ChatSettings,
  ThinkingDisplaySettings as ThinkingDisplaySettingsType,
  DEFAULT_THINKING_DISPLAY_SETTINGS,
} from './types'

export interface ThinkingDisplaySettingsProps {
  settings: ChatSettings
  saving: boolean
  onUpdate: (updates: Partial<ThinkingDisplaySettingsType>) => Promise<void>
}

/**
 * Global defaults for showing reasoning models' chain-of-thought ("thinking")
 * in the Salon. DISPLAY ONLY — these only govern whether captured reasoning is
 * shown; reasoning is always captured and stored regardless, and is never fed
 * back to any model. Per-chat overrides live in the Salon's Visibility sidebar.
 */
export function ThinkingDisplaySettings({ settings, saving, onUpdate }: ThinkingDisplaySettingsProps) {
  const defaultVisible = settings.thinkingDisplay?.defaultVisible ?? DEFAULT_THINKING_DISPLAY_SETTINGS.defaultVisible ?? true
  const defaultCollapsed = settings.thinkingDisplay?.defaultCollapsed ?? DEFAULT_THINKING_DISPLAY_SETTINGS.defaultCollapsed ?? true

  return (
    <SettingsCard title="Thinking / Reasoning" subtitle="Whether new chats show reasoning models' chain-of-thought">
      <div className="space-y-3">
        <label className="flex items-start gap-3 p-4 border qt-border-default rounded hover:bg-accent cursor-pointer transition-colors">
          <input
            type="checkbox"
            checked={defaultVisible}
            onChange={(e) => onUpdate({ defaultVisible: e.target.checked })}
            disabled={saving}
            className="mt-1 h-4 w-4 rounded border-input text-primary focus:ring-primary"
          />
          <div className="flex-1">
            <div className="font-medium">Show thinking by default</div>
            <div className="qt-text-small">
              New chats reveal a thinking model&apos;s reasoning in the bubble. Reasoning is always captured and
              stored either way — this only governs whether it is shown, and it is never sent back to any model.
            </div>
          </div>
        </label>

        <label className={`flex items-start gap-3 p-4 border qt-border-default rounded transition-colors ${defaultVisible ? 'hover:bg-accent cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
          <input
            type="checkbox"
            checked={defaultCollapsed}
            onChange={(e) => onUpdate({ defaultCollapsed: e.target.checked })}
            disabled={saving || !defaultVisible}
            className="mt-1 h-4 w-4 rounded border-input text-primary focus:ring-primary"
          />
          <div className="flex-1">
            <div className="font-medium">Start collapsed</div>
            <div className="qt-text-small">
              When thinking is shown, the block begins folded away — one click expands it. Turn this off to show the
              full reasoning unfurled.
            </div>
          </div>
        </label>
      </div>
    </SettingsCard>
  )
}
