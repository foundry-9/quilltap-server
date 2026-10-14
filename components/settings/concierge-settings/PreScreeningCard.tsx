'use client'

import { SettingsToggleRow } from '@/components/settings/chat-settings/components/SettingsToggleRow'
import type {
  ConciergeSettings,
  ConciergeSettingsUpdate,
} from '@/components/settings/chat-settings/types'

export interface PreScreeningCardProps {
  settings: ConciergeSettings
  saving: boolean
  onUpdate: (updates: ConciergeSettingsUpdate) => Promise<void>
}

/**
 * The optional classifier: pre-screening messages and image prompts before
 * they are sent, and the background summary read that may switch a chat to
 * Unmoderated. Everything here is off for new installs — refusals, not
 * guesses, are what the Concierge acts on by default.
 */
export function PreScreeningCard({ settings, saving, onUpdate }: PreScreeningCardProps) {
  const preScreen = settings.preScreen
  const scansDisabled = saving || !preScreen.enabled

  return (
    <div className="space-y-6">
      <SettingsToggleRow
        checked={preScreen.enabled}
        disabled={saving}
        onChange={(value) => onUpdate({ preScreen: { enabled: value } })}
        heading="Pre-screen before sending"
      >
        Classify messages and image prompts before they are sent, and route anything flagged on a Moderated
        chat to the uncensored desk without waiting for a refusal. Costs a classification call per item.
      </SettingsToggleRow>

      <div className="space-y-3">
        <div className="qt-text-label">What to scan</div>

        <SettingsToggleRow
          checked={preScreen.scanTextChat}
          disabled={scansDisabled}
          onChange={(value) => onUpdate({ preScreen: { scanTextChat: value } })}
          heading="Text chat messages"
        >
          Classify your messages before they are sent to the LLM.
        </SettingsToggleRow>

        <SettingsToggleRow
          checked={preScreen.scanImagePrompts}
          disabled={scansDisabled}
          onChange={(value) => onUpdate({ preScreen: { scanImagePrompts: value } })}
          heading="Image prompts"
        >
          Classify image generation prompts before expansion.
        </SettingsToggleRow>

        <SettingsToggleRow
          checked={preScreen.scanImageGeneration}
          disabled={scansDisabled}
          onChange={(value) => onUpdate({ preScreen: { scanImageGeneration: value } })}
          heading="Image generation"
        >
          Classify the expanded prompt before it is sent to the image generator.
        </SettingsToggleRow>
      </div>

      <SettingsToggleRow
        checked={preScreen.summaryClassification}
        disabled={saving}
        onChange={(value) => onUpdate({ preScreen: { summaryClassification: value } })}
        heading="Read each chat's summary in the background and switch it when it looks dangerous"
      >
        Every ten minutes the Concierge reads the summaries of Moderated chats and moves any that read as
        dangerous to Unmoderated, with an announcement. Locked chats are never moved.
      </SettingsToggleRow>

      <div className="space-y-2">
        <label htmlFor="concierge-threshold" className="block qt-text-label">
          Detection threshold ({preScreen.threshold.toFixed(1)})
        </label>
        <input
          id="concierge-threshold"
          type="range"
          min="0.1"
          max="1.0"
          step="0.1"
          value={preScreen.threshold}
          onChange={(e) => onUpdate({ preScreen: { threshold: parseFloat(e.target.value) } })}
          disabled={saving}
          className="qt-range w-full max-w-xs"
        />
        <p className="qt-text-small">
          Lower values flag more content; higher values flag only strongly dangerous content.
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="concierge-custom-classification-prompt" className="block qt-text-label">
          Custom classification prompt (optional)
        </label>
        <textarea
          id="concierge-custom-classification-prompt"
          value={preScreen.customClassificationPrompt || ''}
          onChange={(e) => onUpdate({ preScreen: { customClassificationPrompt: e.target.value || null } })}
          disabled={saving}
          rows={3}
          placeholder="Additional instructions for the content classifier..."
          className="qt-textarea"
        />
        <p className="qt-text-small">
          Appended to the classification prompt. Use it to adjust sensitivity for your use case.
        </p>
      </div>

      <div className="qt-alert-info">
        <ul className="qt-text-small space-y-1 list-disc list-inside">
          <li>With an OpenAI connection profile, classification uses the free OpenAI moderation endpoint.</li>
          <li>Otherwise it falls back to your cheap LLM, at a small cost per item.</li>
          <li>Classification is fail-safe: an error never blocks a message.</li>
        </ul>
      </div>
    </div>
  )
}
