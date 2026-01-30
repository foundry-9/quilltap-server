'use client'

import { SettingsCard } from '@/components/ui/SettingsCard'
import { ChatSettings, TokenDisplaySettings, TOKEN_DISPLAY_OPTIONS, DEFAULT_TOKEN_DISPLAY_SETTINGS } from './types'

export interface TokenDisplaySettingsProps {
  settings: ChatSettings
  saving: boolean
  onTokenDisplayChange: (key: keyof TokenDisplaySettings, value: boolean) => Promise<void>
}

/**
 * TokenDisplaySettings Component
 * Manages token and cost display preferences in chats
 */
export function TokenDisplaySettingsComponent({
  settings,
  saving,
  onTokenDisplayChange,
}: TokenDisplaySettingsProps) {
  // Use default settings if not defined
  const tokenSettings = settings.tokenDisplaySettings || DEFAULT_TOKEN_DISPLAY_SETTINGS

  return (
    <SettingsCard
      title="Token & Cost Display"
      subtitle="Control the visibility of token usage and cost information in chats. Enabling these options helps you track your API usage and costs."
    >
      <div className="space-y-3">
        {TOKEN_DISPLAY_OPTIONS.map((option) => (
          <label
            key={option.key}
            className="flex items-start gap-3 p-4 border border-border rounded hover:bg-accent cursor-pointer transition-colors"
          >
            <input
              type="checkbox"
              checked={tokenSettings[option.key]}
              onChange={(e) => onTokenDisplayChange(option.key, e.target.checked)}
              disabled={saving}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <div className="flex-1">
              <div className="font-medium">{option.label}</div>
              <div className="qt-text-small">
                {option.description}
              </div>
            </div>
          </label>
        ))}
      </div>

      <div className="mt-4 p-4 border border-border rounded bg-muted/50">
        <p className="qt-text-small text-muted-foreground">
          <strong>Note:</strong> Cost estimates are based on pricing data from OpenRouter when available,
          or fallback pricing for other providers. Actual costs may vary slightly.
        </p>
      </div>
    </SettingsCard>
  )
}
