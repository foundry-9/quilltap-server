'use client'

import { SettingsCard } from '@/components/ui/SettingsCard'
import {
  ChatSettings,
  AUTOMATION_OPTIONS,
  DEFAULT_AUTO_DETECT_RNG,
} from './types'

export interface AutomationSettingsProps {
  settings: ChatSettings
  saving: boolean
  onAutoDetectRngChange: (value: boolean) => Promise<void>
}

/**
 * AutomationSettings Component
 * Manages automation settings including auto-detect RNG calls
 */
export function AutomationSettings({
  settings,
  saving,
  onAutoDetectRngChange,
}: AutomationSettingsProps) {
  const autoDetectRng = settings.autoDetectRng ?? DEFAULT_AUTO_DETECT_RNG

  return (
    <SettingsCard title="Automation" subtitle="Configure automatic behavior in chats">
      <div className="space-y-3">
        {AUTOMATION_OPTIONS.map((option) => (
          <label
            key={option.key}
            className="flex items-start gap-3 p-4 border qt-border-default rounded hover:bg-accent cursor-pointer transition-colors"
          >
            <input
              type="checkbox"
              checked={option.key === 'autoDetectRng' ? autoDetectRng : false}
              onChange={(e) => {
                if (option.key === 'autoDetectRng') {
                  onAutoDetectRngChange(e.target.checked)
                }
              }}
              disabled={saving}
              className="mt-1 h-4 w-4 rounded border-input text-primary focus:ring-primary"
            />
            <div className="flex-1">
              <div className="font-medium">{option.label}</div>
              <div className="qt-text-small">{option.description}</div>
            </div>
          </label>
        ))}
      </div>
    </SettingsCard>
  )
}
