'use client'

/**
 * Context Compression Settings Component
 *
 * Allows users to configure the sliding window context compression feature
 * that reduces token costs by compressing older messages using a cheap LLM.
 */

import { useState, useId } from 'react'
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

  // Track which slider is being dragged (null when not dragging)
  const [dragging, setDragging] = useState<'window' | 'compression' | 'projectContext' | null>(null)

  // Local state for sliders to allow smooth dragging
  const [localWindowSize, setLocalWindowSize] = useState(compressionSettings.windowSize)
  const [localCompressionTarget, setLocalCompressionTarget] = useState(compressionSettings.compressionTargetTokens)
  // System prompt compression removed — only message history is compressed
  const [localProjectContextInterval, setLocalProjectContextInterval] = useState(compressionSettings.projectContextReinjectInterval ?? DEFAULT_CONTEXT_COMPRESSION_SETTINGS.projectContextReinjectInterval)

  // Use local value while dragging, otherwise use settings value (for external updates)
  const displayWindowSize = dragging === 'window' ? localWindowSize : compressionSettings.windowSize
  const displayCompressionTarget = dragging === 'compression' ? localCompressionTarget : compressionSettings.compressionTargetTokens
  const displayProjectContextInterval = dragging === 'projectContext' ? localProjectContextInterval : (compressionSettings.projectContextReinjectInterval ?? DEFAULT_CONTEXT_COMPRESSION_SETTINGS.projectContextReinjectInterval)

  const handleEnabledChange = (enabled: boolean) => {
    onUpdate({ enabled })
  }

  const handleWindowSizeStart = () => {
    setDragging('window')
    setLocalWindowSize(compressionSettings.windowSize)
  }

  const handleWindowSizeChange = (windowSize: number) => {
    const clampedValue = Math.min(WINDOW.max, Math.max(WINDOW.min, windowSize))
    setLocalWindowSize(clampedValue)
  }

  const handleWindowSizeCommit = () => {
    setDragging(null)
    if (localWindowSize !== compressionSettings.windowSize) {
      onUpdate({ windowSize: localWindowSize })
    }
  }

  const handleCompressionTargetStart = () => {
    setDragging('compression')
    setLocalCompressionTarget(compressionSettings.compressionTargetTokens)
  }

  const handleCompressionTargetChange = (compressionTargetTokens: number) => {
    const clampedValue = Math.min(COMPRESSION_TARGET.max, Math.max(COMPRESSION_TARGET.min, compressionTargetTokens))
    setLocalCompressionTarget(clampedValue)
  }

  const handleCompressionTargetCommit = () => {
    setDragging(null)
    if (localCompressionTarget !== compressionSettings.compressionTargetTokens) {
      onUpdate({ compressionTargetTokens: localCompressionTarget })
    }
  }


  const handleProjectContextIntervalStart = () => {
    setDragging('projectContext')
    setLocalProjectContextInterval(compressionSettings.projectContextReinjectInterval ?? DEFAULT_CONTEXT_COMPRESSION_SETTINGS.projectContextReinjectInterval)
  }

  const handleProjectContextIntervalChange = (interval: number) => {
    // Minimum is windowSize (no point sending more often than window)
    // 0 means disabled (only on initial message)
    const minValue = displayWindowSize
    const clampedValue = interval === 0 ? 0 : Math.min(PROJECT_CONTEXT.max, Math.max(minValue, interval))
    setLocalProjectContextInterval(clampedValue)
  }

  const handleProjectContextIntervalCommit = () => {
    setDragging(null)
    if (localProjectContextInterval !== (compressionSettings.projectContextReinjectInterval ?? DEFAULT_CONTEXT_COMPRESSION_SETTINGS.projectContextReinjectInterval)) {
      onUpdate({ projectContextReinjectInterval: localProjectContextInterval })
    }
  }

  // When window size changes, ensure project context interval is still valid
  const handleWindowSizeChangeWithValidation = (windowSize: number) => {
    const clampedValue = Math.min(WINDOW.max, Math.max(WINDOW.min, windowSize))
    setLocalWindowSize(clampedValue)
    // If project context interval is now below the new window size, adjust it
    if (localProjectContextInterval !== 0 && localProjectContextInterval < clampedValue) {
      setLocalProjectContextInterval(clampedValue)
    }
  }

  const handleWindowSizeCommitWithValidation = () => {
    setDragging(null)
    const updates: Partial<ContextCompressionSettings> = {}
    if (localWindowSize !== compressionSettings.windowSize) {
      updates.windowSize = localWindowSize
    }
    // Also update project context interval if it's now invalid
    const currentInterval = compressionSettings.projectContextReinjectInterval ?? DEFAULT_CONTEXT_COMPRESSION_SETTINGS.projectContextReinjectInterval
    if (currentInterval !== 0 && currentInterval < localWindowSize) {
      updates.projectContextReinjectInterval = localWindowSize
    }
    if (Object.keys(updates).length > 0) {
      onUpdate(updates)
    }
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
            value={displayWindowSize}
            onMouseDown={handleWindowSizeStart}
            onTouchStart={handleWindowSizeStart}
            onChange={(e) => handleWindowSizeChangeWithValidation(parseInt(e.target.value, 10))}
            onMouseUp={handleWindowSizeCommitWithValidation}
            onTouchEnd={handleWindowSizeCommitWithValidation}
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
            value={displayCompressionTarget}
            onMouseDown={handleCompressionTargetStart}
            onTouchStart={handleCompressionTargetStart}
            onChange={(e) => handleCompressionTargetChange(parseInt(e.target.value, 10))}
            onMouseUp={handleCompressionTargetCommit}
            onTouchEnd={handleCompressionTargetCommit}
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
            value={displayProjectContextInterval === 0 ? displayWindowSize : displayProjectContextInterval}
            onMouseDown={handleProjectContextIntervalStart}
            onTouchStart={handleProjectContextIntervalStart}
            onChange={(e) => handleProjectContextIntervalChange(parseInt(e.target.value, 10))}
            onMouseUp={handleProjectContextIntervalCommit}
            onTouchEnd={handleProjectContextIntervalCommit}
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
