'use client'

import { useId } from 'react'
import { SettingsCard } from '@/components/ui/SettingsCard'
import type { ChatSettings } from './types'

export interface AgentModeSettingsProps {
  settings: ChatSettings
  saving: boolean
  onDefaultEnabledChange: (value: boolean) => Promise<void>
  onMaxTurnsChange: (value: number) => Promise<void>
}

const MAX_TURNS_OPTIONS = [
  { value: 5, label: '5 turns' },
  { value: 10, label: '10 turns (default)' },
  { value: 15, label: '15 turns' },
  { value: 20, label: '20 turns' },
  { value: 25, label: '25 turns' },
  { value: 30, label: '30 turns' },
  { value: 40, label: '40 turns' },
  { value: 50, label: '50 turns (maximum)' },
]

export function AgentModeSettings({
  settings,
  saving,
  onDefaultEnabledChange,
  onMaxTurnsChange,
}: AgentModeSettingsProps) {
  const id = useId()
  const agentModeSettings = settings.agentModeSettings ?? {
    maxTurns: 10,
    defaultEnabled: false,
  }

  return (
    <SettingsCard
      title="Agent Mode"
      subtitle="Configure iterative tool use with self-correction"
    >
      <div className="space-y-6">
        {/* Default Enabled Toggle */}
        <div>
          <label className="flex items-start gap-3 p-4 border qt-border-default rounded qt-hover-accent cursor-pointer">
            <input
              type="checkbox"
              checked={agentModeSettings.defaultEnabled}
              onChange={(e) => onDefaultEnabledChange(e.target.checked)}
              disabled={saving}
              className="mt-1 qt-checkbox"
            />
            <div className="flex-1">
              <div className="font-medium qt-text">
                Enable Agent Mode by Default
              </div>
              <div className="qt-text-small mt-1">
                When enabled, new chats will use agent mode, allowing the AI to iteratively
                use tools, verify results, and self-correct before delivering a final response.
              </div>
            </div>
          </label>
        </div>

        {/* Max Turns Setting */}
        <div className="space-y-2">
          <label className="block font-medium qt-text" htmlFor={`${id}-max-turns`}>
            Maximum Agent Turns
          </label>
          <p className="qt-text-small">
            The maximum number of tool iterations before the AI must deliver its final response.
            Higher values allow more thorough exploration but may increase response time and cost.
          </p>
          <select
            id={`${id}-max-turns`}
            value={agentModeSettings.maxTurns}
            onChange={(e) => onMaxTurnsChange(parseInt(e.target.value, 10))}
            disabled={saving}
            className="w-full max-w-xs rounded-lg border qt-border-default qt-bg-card px-3 py-2 qt-text focus:qt-border-primary focus:outline-none focus:ring-1 qt-focus-ring"
          >
            {MAX_TURNS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {/* Info Box */}
        <div className="border qt-border-default rounded-lg p-4 qt-bg-muted/50">
          <h4 className="font-medium qt-text mb-2">How Agent Mode Works</h4>
          <ul className="qt-text-small space-y-1 list-disc list-inside">
            <li>The AI uses tools iteratively to gather information and verify results</li>
            <li>Each tool use counts as one &quot;turn&quot; toward the maximum</li>
            <li>When ready, the AI calls <code className="qt-bg-muted px-1 rounded">submit_final_response</code> to deliver its answer</li>
            <li>If the turn limit is reached, the AI is prompted to submit its best answer</li>
            <li>Agent mode can be enabled/disabled per-character, per-project, or per-chat</li>
          </ul>
        </div>
      </div>
    </SettingsCard>
  )
}
