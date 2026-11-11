'use client'

import { SettingsCard } from '@/components/ui/SettingsCard'
import { useDraft } from '@/lib/hooks/use-draft'
import { ChatSettings, LLMLoggingSettings, DEFAULT_LLM_LOGGING_SETTINGS } from './types'

export interface LLMLoggingSettingsProps {
  settings: ChatSettings
  saving: boolean
  onLLMLoggingChange: (key: keyof LLMLoggingSettings, value: boolean | number) => Promise<void>
}

/**
 * LLMLoggingSettings Component
 * Manages LLM request/response logging preferences
 */
export function LLMLoggingSettingsComponent({
  settings,
  saving,
  onLLMLoggingChange,
}: LLMLoggingSettingsProps) {
  // Use default settings if not defined
  const loggingSettings = settings.llmLoggingSettings || DEFAULT_LLM_LOGGING_SETTINGS

  // The retention field is typed into and saved on blur or Enter, never per
  // keystroke (typing "60" over "30" used to save 6 first). An empty or
  // unreadable field is "no change" — 0 means unlimited, so it is never
  // inferred from a blank.
  const [retentionDraft, setRetentionDraft, retention] = useDraft(String(loggingSettings.retentionDays))
  const commitRetention = () => {
    const parsed = Number.parseInt(retentionDraft, 10)
    if (retentionDraft.trim() === '' || Number.isNaN(parsed)) {
      retention.reset()
      return
    }
    const days = Math.min(365, Math.max(0, parsed))
    setRetentionDraft(String(days))
    if (days !== loggingSettings.retentionDays) void onLLMLoggingChange('retentionDays', days)
  }

  return (
    <SettingsCard
      title="LLM Request Logging"
      subtitle="Log LLM API requests and responses for debugging and monitoring. Logs can be viewed per message in chats or on the Tools page."
    >
      <div className="space-y-3">
        {/* Enable logging toggle */}
        <label className="flex items-start gap-3 p-4 border qt-border-default rounded qt-hover-accent cursor-pointer transition-colors">
          <input
            type="checkbox"
            checked={loggingSettings.enabled}
            onChange={(e) => onLLMLoggingChange('enabled', e.target.checked)}
            disabled={saving}
            className="mt-1 h-4 w-4 rounded border-input text-primary focus:ring-primary"
          />
          <div className="flex-1">
            <div className="font-medium">Enable Logging</div>
            <div className="qt-text-small">
              Store LLM request/response data for each message. Useful for debugging and monitoring API usage.
            </div>
          </div>
        </label>

        {/* Verbose mode toggle */}
        <label className={`flex items-start gap-3 p-4 border qt-border-default rounded qt-hover-accent cursor-pointer transition-colors ${!loggingSettings.enabled ? 'opacity-50' : ''}`}>
          <input
            type="checkbox"
            checked={loggingSettings.verboseMode}
            onChange={(e) => onLLMLoggingChange('verboseMode', e.target.checked)}
            disabled={saving || !loggingSettings.enabled}
            className="mt-1 h-4 w-4 rounded border-input text-primary focus:ring-primary"
          />
          <div className="flex-1">
            <div className="font-medium">Verbose Mode</div>
            <div className="qt-text-small">
              Store full message content in logs (requires more storage). When disabled, only summaries are stored.
            </div>
          </div>
        </label>

        {/* Retention days input */}
        <div className={`p-4 border qt-border-default rounded ${!loggingSettings.enabled ? 'opacity-50' : ''}`}>
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="font-medium">Log Retention</div>
              <div className="qt-text-small">
                Automatically delete logs older than this many days. Set to 0 for unlimited retention.
              </div>
            </div>
            <div className="flex items-center gap-2 ml-4">
              <input
                type="number"
                aria-label="Log retention in days"
                min={0}
                max={365}
                value={retentionDraft}
                onChange={(e) => setRetentionDraft(e.target.value)}
                onBlur={commitRetention}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRetention()
                }}
                disabled={saving || !loggingSettings.enabled}
                className="w-20 px-2 py-1 border qt-border-default rounded text-center"
              />
              <span className="qt-text-secondary">days</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 p-4 border qt-border-default rounded qt-bg-muted/50">
        <p className="qt-text-small qt-text-secondary">
          <strong>Privacy Note:</strong> LLM logs contain your conversations and API responses.
          They are stored locally in your database and included in backups.
          Logs are automatically cleaned up based on your retention settings.
        </p>
      </div>
    </SettingsCard>
  )
}
