'use client'

/**
 * Context Compression Settings Component
 *
 * Allows users to configure the sliding window context compression feature
 * that reduces token costs by compressing older messages using a cheap LLM.
 */

import { useId } from 'react'
import { useCommittedRange } from '@/hooks/useCommittedRange'
import { SettingsCard } from '@/components/ui/SettingsCard'
import {
  ChatSettings,
  ContextCompressionSettings,
  DEFAULT_CONTEXT_COMPRESSION_SETTINGS,
} from './types'
import { ContextCompressionSettingsSchema } from '@/lib/schemas/settings.types'

// The server's bounds for each dial (`ContextCompressionSettingsSchema`).
const bounds = (field: 'windowSize' | 'compressionTargetTokens' | 'projectContextReinjectInterval') => {
  const n = ContextCompressionSettingsSchema.shape[field].unwrap()
  return { min: n.minValue ?? 0, max: n.maxValue ?? Number.MAX_SAFE_INTEGER }
}
const WINDOW = bounds('windowSize')
const COMPRESSION_TARGET = bounds('compressionTargetTokens')
const PROJECT_CONTEXT = bounds('projectContextReinjectInterval')

interface ContextCompressionSettingsProps {
  settings: ChatSettings
  saving: boolean
  onUpdate: (updates: Partial<ContextCompressionSettings>) => Promise<void>
}

export function ContextCompressionSettingsComponent({
  settings,
  saving,
  onUpdate,
}: ContextCompressionSettingsProps) {
  const id = useId()
  const compressionSettings = settings.contextCompressionSettings || DEFAULT_CONTEXT_COMPRESSION_SETTINGS

  const persistedProjectContextInterval =
    compressionSettings.projectContextReinjectInterval ?? DEFAULT_CONTEXT_COMPRESSION_SETTINGS.projectContextReinjectInterval

  // Each slider shows its value live and saves on release — pointer, touch,
  // pen or keyboard (#259).
  const windowRange = useCommittedRange({
    persisted: compressionSettings.windowSize,
    normalize: (v) => Math.min(WINDOW.max, Math.max(WINDOW.min, v)),
    commit: (windowSize) => {
      const updates: Partial<ContextCompressionSettings> = { windowSize }
      // The project context interval may not fall below the window size.
      if (persistedProjectContextInterval !== 0 && persistedProjectContextInterval < windowSize) {
        updates.projectContextReinjectInterval = windowSize
      }
      return onUpdate(updates)
    },
  })
  const displayWindowSize = windowRange.value

  const compressionRange = useCommittedRange({
    persisted: compressionSettings.compressionTargetTokens,
    normalize: (v) => Math.min(COMPRESSION_TARGET.max, Math.max(COMPRESSION_TARGET.min, v)),
    commit: (compressionTargetTokens) => onUpdate({ compressionTargetTokens }),
  })
  const displayCompressionTarget = compressionRange.value

  const projectContextRange = useCommittedRange({
    persisted: persistedProjectContextInterval,
    // Minimum is the window size (no point sending more often than the
    // window); 0 means disabled (only on the initial message).
    normalize: (v) => (v === 0 ? 0 : Math.min(PROJECT_CONTEXT.max, Math.max(displayWindowSize, v))),
    commit: (projectContextReinjectInterval) => onUpdate({ projectContextReinjectInterval }),
  })
  const displayProjectContextInterval = projectContextRange.value

  const handleEnabledChange = (enabled: boolean) => {
    onUpdate({ enabled })
  }

  return (
    <SettingsCard
      title="Context Compression"
      subtitle="Reduce token costs in long conversations by compressing older messages using a cheap LLM. Recent messages are kept in full context while older messages are summarized."
    >
      <div className="space-y-6">
        {/* Enable/Disable Toggle */}
        <div className="flex items-center justify-between">
          <div>
            <label id={`${id}-enabled`} className="qt-text-label block">Enable Context Compression</label>
            <p className="qt-text-xs qt-text-secondary mt-1">
              When enabled, older messages beyond the sliding window are compressed to save tokens.
            </p>
          </div>
          <button
            type="button"
            onClick={() => handleEnabledChange(!compressionSettings.enabled)}
            disabled={saving}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              compressionSettings.enabled
                ? 'qt-bg-primary'
                : 'qt-toggle-off'
            } ${saving ? 'opacity-50 cursor-not-allowed' : ''}`}
            role="switch"
            aria-checked={compressionSettings.enabled}
            aria-labelledby={`${id}-enabled`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full qt-bg-default transition-transform ${
                compressionSettings.enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* Window Size */}
        <div className={!compressionSettings.enabled ? 'opacity-50 pointer-events-none' : ''}>
          <label htmlFor={`${id}-window`} className="qt-text-label block mb-2">
            Sliding Window Size
            <span className="qt-text-xs qt-text-secondary ml-2">
              ({displayWindowSize} messages)
            </span>
          </label>
          <input
            id={`${id}-window`}
            type="range"
            min={WINDOW.min}
            max={WINDOW.max}
            {...windowRange.inputProps}
            disabled={!compressionSettings.enabled}
            className="qt-range w-full"
          />
          <div className="flex justify-between qt-text-xs qt-text-secondary mt-1">
            <span>{WINDOW.min} (more aggressive)</span>
            <span>{WINDOW.max} (more context)</span>
          </div>
          <p className="qt-text-xs qt-text-secondary mt-2">
            Number of recent messages to keep in full context. Messages older than this are compressed.
          </p>
        </div>

        {/* Compression Target Tokens */}
        <div className={!compressionSettings.enabled ? 'opacity-50 pointer-events-none' : ''}>
          <label htmlFor={`${id}-compression`} className="qt-text-label block mb-2">
            History Compression Target
            <span className="qt-text-xs qt-text-secondary ml-2">
              (~{displayCompressionTarget} tokens)
            </span>
          </label>
          <input
            id={`${id}-compression`}
            type="range"
            min={COMPRESSION_TARGET.min}
            max={COMPRESSION_TARGET.max}
            step={100}
            {...compressionRange.inputProps}
            disabled={!compressionSettings.enabled}
            className="qt-range w-full"
          />
          <div className="flex justify-between qt-text-xs qt-text-secondary mt-1">
            <span>{COMPRESSION_TARGET.min} (minimal)</span>
            <span>{COMPRESSION_TARGET.max} (detailed)</span>
          </div>
          <p className="qt-text-xs qt-text-secondary mt-2">
            Target token count for compressed conversation history.
          </p>
        </div>

        {/* Project Context Re-injection Interval */}
        <div className={!compressionSettings.enabled ? 'opacity-50 pointer-events-none' : ''}>
          <label htmlFor={`${id}-project-context`} className="qt-text-label block mb-2">
            Project Context Re-injection
            <span className="qt-text-xs qt-text-secondary ml-2">
              (every {displayProjectContextInterval === 0 ? 'never' : `${displayProjectContextInterval} messages`})
            </span>
          </label>
          <input
            id={`${id}-project-context`}
            type="range"
            min={displayWindowSize}
            max={PROJECT_CONTEXT.max}
            {...projectContextRange.inputProps}
            value={displayProjectContextInterval === 0 ? displayWindowSize : displayProjectContextInterval}
            disabled={!compressionSettings.enabled}
            className="qt-range w-full"
          />
          <div className="flex justify-between qt-text-xs qt-text-secondary mt-1">
            <span>{displayWindowSize} (minimum)</span>
            <span>{PROJECT_CONTEXT.max} (less frequent)</span>
          </div>
          <p className="qt-text-xs qt-text-secondary mt-2">
            How often to re-inject project instructions into the system prompt. Set to the window size to ensure
            project context is always present in recent messages.
          </p>
        </div>

        {/* Info Box */}
        <div className="qt-bg-muted rounded-lg p-4 qt-text-small">
          <p className="font-medium mb-2">How it works:</p>
          <ul className="list-disc list-inside space-y-1 qt-text-secondary">
            <li>The AI keeps full access to your most recent {displayWindowSize} messages</li>
            <li>Older messages are summarized together by a fast, inexpensive LLM</li>
            <li>Tool definitions are never compressed</li>
            <li>The AI can use request_full_context to reload the full conversation if needed</li>
          </ul>
        </div>
      </div>
    </SettingsCard>
  )
}
