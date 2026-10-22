'use client'

import { SettingsCard } from '@/components/ui/SettingsCard'
import {
  ChatSettings,
  AUTOMATION_OPTIONS,
  DEFAULT_AUTO_DETECT_RNG,
  DEFAULT_CUSTOM_TOOLS,
  DEFAULT_CUSTOM_TOOL_TRIGGERS,
  DEFAULT_CUSTOM_TOOL_INTERVENTION,
  type AutomationKey,
} from './types'

export interface AutomationSettingsProps {
  settings: ChatSettings
  saving: boolean
  onAutoDetectRngChange: (value: boolean) => Promise<void>
  onCustomToolTriggersChange: (value: boolean) => Promise<void>
  onCustomToolInterventionChange: (value: boolean) => Promise<void>
}

/** One row's state: its value, its writer, and whether it is dead right now. */
interface AutomationRow {
  value: boolean
  onChange: (value: boolean) => Promise<void>
  disabled?: boolean
}

/**
 * AutomationSettings Component
 * Manages automation settings: auto-detect RNG calls, and custom tools run by
 * their trigger phrases (dead while Custom Tools is off).
 */
export function AutomationSettings({
  settings,
  saving,
  onAutoDetectRngChange,
  onCustomToolTriggersChange,
  onCustomToolInterventionChange,
}: AutomationSettingsProps) {
  const customToolsOn = settings.customTools ?? DEFAULT_CUSTOM_TOOLS

  const rows: Record<AutomationKey, AutomationRow> = {
    autoDetectRng: {
      value: settings.autoDetectRng ?? DEFAULT_AUTO_DETECT_RNG,
      onChange: onAutoDetectRngChange,
    },
    customToolTriggers: {
      value: settings.customToolTriggers ?? DEFAULT_CUSTOM_TOOL_TRIGGERS,
      onChange: onCustomToolTriggersChange,
      disabled: !customToolsOn,
    },
    customToolIntervention: {
      value: settings.customToolIntervention ?? DEFAULT_CUSTOM_TOOL_INTERVENTION,
      onChange: onCustomToolInterventionChange,
      disabled: !customToolsOn,
    },
  }

  return (
    <SettingsCard title="Automation" subtitle="Configure automatic behavior in chats">
      <div className="space-y-3">
        {AUTOMATION_OPTIONS.map((option) => {
          const row = rows[option.key]
          const disabled = saving || row.disabled === true
          return (
            <label
              key={option.key}
              className={`flex items-start gap-3 p-4 border qt-border-default rounded transition-colors ${
                row.disabled ? 'opacity-50 cursor-not-allowed' : 'qt-hover-accent cursor-pointer'
              }`}
            >
              <input
                type="checkbox"
                checked={row.value}
                onChange={(e) => { void row.onChange(e.target.checked) }}
                disabled={disabled}
                className="mt-1 h-4 w-4 rounded border-input text-primary focus:ring-primary"
              />
              <div className="flex-1">
                <div className="font-medium">{option.label}</div>
                <div className="qt-text-small">{option.description}</div>
              </div>
            </label>
          )
        })}
      </div>
    </SettingsCard>
  )
}
