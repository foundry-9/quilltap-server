'use client'

/**
 * Context Compression Settings Component
 *
 * Allows users to configure the sliding window context compression feature
 * that reduces token costs by compressing older messages using a cheap LLM.
 */

import { useState } from 'react'
import { SettingsCard } from '@/components/ui/SettingsCard'
import {
  ChatSettings,
  ContextCompressionSettings,
  DEFAULT_CONTEXT_COMPRESSION_SETTINGS,
} from './types'

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
  const compressionSettings = settings.contextCompressionSettings || DEFAULT_CONTEXT_COMPRESSION_SETTINGS

  // Track which slider is being dragged (null when not dragging)
  const [dragging, setDragging] = useState<'window' | 'compression' | 'system' | null>(null)

  // Local state for sliders to allow smooth dragging
  const [localWindowSize, setLocalWindowSize] = useState(compressionSettings.windowSize)
  const [localCompressionTarget, setLocalCompressionTarget] = useState(compressionSettings.compressionTargetTokens)
  const [localSystemPromptTarget, setLocalSystemPromptTarget] = useState(compressionSettings.systemPromptTargetTokens)

  // Use local value while dragging, otherwise use settings value (for external updates)
  const displayWindowSize = dragging === 'window' ? localWindowSize : compressionSettings.windowSize
  const displayCompressionTarget = dragging === 'compression' ? localCompressionTarget : compressionSettings.compressionTargetTokens
  const displaySystemPromptTarget = dragging === 'system' ? localSystemPromptTarget : compressionSettings.systemPromptTargetTokens

  const handleEnabledChange = (enabled: boolean) => {
    onUpdate({ enabled })
  }

  const handleWindowSizeStart = () => {
    setDragging('window')
    setLocalWindowSize(compressionSettings.windowSize)
  }

  const handleWindowSizeChange = (windowSize: number) => {
    // Clamp value between 3 and 10
    const clampedValue = Math.min(10, Math.max(3, windowSize))
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
    // Clamp value between 300 and 2000
    const clampedValue = Math.min(2000, Math.max(300, compressionTargetTokens))
    setLocalCompressionTarget(clampedValue)
  }

  const handleCompressionTargetCommit = () => {
    setDragging(null)
    if (localCompressionTarget !== compressionSettings.compressionTargetTokens) {
      onUpdate({ compressionTargetTokens: localCompressionTarget })
    }
  }

  const handleSystemPromptTargetStart = () => {
    setDragging('system')
    setLocalSystemPromptTarget(compressionSettings.systemPromptTargetTokens)
  }

  const handleSystemPromptTargetChange = (systemPromptTargetTokens: number) => {
    // Clamp value between 500 and 3000
    const clampedValue = Math.min(3000, Math.max(500, systemPromptTargetTokens))
    setLocalSystemPromptTarget(clampedValue)
  }

  const handleSystemPromptTargetCommit = () => {
    setDragging(null)
    if (localSystemPromptTarget !== compressionSettings.systemPromptTargetTokens) {
      onUpdate({ systemPromptTargetTokens: localSystemPromptTarget })
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
            <label className="qt-text-label block">Enable Context Compression</label>
            <p className="qt-text-xs text-muted-foreground mt-1">
              When enabled, older messages beyond the sliding window are compressed to save tokens.
            </p>
          </div>
          <button
            type="button"
            onClick={() => handleEnabledChange(!compressionSettings.enabled)}
            disabled={saving}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              compressionSettings.enabled
                ? 'bg-primary'
                : 'bg-muted'
            } ${saving ? 'opacity-50 cursor-not-allowed' : ''}`}
            role="switch"
            aria-checked={compressionSettings.enabled}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-background transition-transform ${
                compressionSettings.enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* Window Size */}
        <div className={!compressionSettings.enabled ? 'opacity-50 pointer-events-none' : ''}>
          <label className="qt-text-label block mb-2">
            Sliding Window Size
            <span className="qt-text-xs text-muted-foreground ml-2">
              ({displayWindowSize} messages)
            </span>
          </label>
          <input
            type="range"
            min={3}
            max={10}
            value={displayWindowSize}
            onMouseDown={handleWindowSizeStart}
            onTouchStart={handleWindowSizeStart}
            onChange={(e) => handleWindowSizeChange(parseInt(e.target.value, 10))}
            onMouseUp={handleWindowSizeCommit}
            onTouchEnd={handleWindowSizeCommit}
            disabled={!compressionSettings.enabled}
            className="w-full cursor-pointer"
          />
          <div className="flex justify-between qt-text-xs text-muted-foreground mt-1">
            <span>3 (more aggressive)</span>
            <span>10 (more context)</span>
          </div>
          <p className="qt-text-xs text-muted-foreground mt-2">
            Number of recent messages to keep in full context. Messages older than this are compressed.
          </p>
        </div>

        {/* Compression Target Tokens */}
        <div className={!compressionSettings.enabled ? 'opacity-50 pointer-events-none' : ''}>
          <label className="qt-text-label block mb-2">
            History Compression Target
            <span className="qt-text-xs text-muted-foreground ml-2">
              (~{displayCompressionTarget} tokens)
            </span>
          </label>
          <input
            type="range"
            min={300}
            max={2000}
            step={100}
            value={displayCompressionTarget}
            onMouseDown={handleCompressionTargetStart}
            onTouchStart={handleCompressionTargetStart}
            onChange={(e) => handleCompressionTargetChange(parseInt(e.target.value, 10))}
            onMouseUp={handleCompressionTargetCommit}
            onTouchEnd={handleCompressionTargetCommit}
            disabled={!compressionSettings.enabled}
            className="w-full cursor-pointer"
          />
          <div className="flex justify-between qt-text-xs text-muted-foreground mt-1">
            <span>300 (minimal)</span>
            <span>2000 (detailed)</span>
          </div>
          <p className="qt-text-xs text-muted-foreground mt-2">
            Target token count for compressed conversation history.
          </p>
        </div>

        {/* System Prompt Target Tokens */}
        <div className={!compressionSettings.enabled ? 'opacity-50 pointer-events-none' : ''}>
          <label className="qt-text-label block mb-2">
            System Prompt Compression Target
            <span className="qt-text-xs text-muted-foreground ml-2">
              (~{displaySystemPromptTarget} tokens)
            </span>
          </label>
          <input
            type="range"
            min={500}
            max={3000}
            step={100}
            value={displaySystemPromptTarget}
            onMouseDown={handleSystemPromptTargetStart}
            onTouchStart={handleSystemPromptTargetStart}
            onChange={(e) => handleSystemPromptTargetChange(parseInt(e.target.value, 10))}
            onMouseUp={handleSystemPromptTargetCommit}
            onTouchEnd={handleSystemPromptTargetCommit}
            disabled={!compressionSettings.enabled}
            className="w-full cursor-pointer"
          />
          <div className="flex justify-between qt-text-xs text-muted-foreground mt-1">
            <span>500 (minimal)</span>
            <span>3000 (detailed)</span>
          </div>
          <p className="qt-text-xs text-muted-foreground mt-2">
            Target token count for compressed system prompt (character instructions).
          </p>
        </div>

        {/* Info Box */}
        <div className="qt-bg-muted rounded-lg p-4 qt-text-small">
          <p className="font-medium mb-2">How it works:</p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
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
