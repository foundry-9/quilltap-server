'use client'

/**
 * Memory Cascade Settings Component
 *
 * Allows users to configure what happens to memories when messages are deleted
 * or regenerated (swiped).
 */

import { SettingsCard } from '@/components/ui/SettingsCard'
import {
  ChatSettings,
  MemoryCascadePreferences,
  MemoryCascadeAction,
  MEMORY_CASCADE_ACTIONS,
  DEFAULT_MEMORY_CASCADE_PREFERENCES,
} from './types'

interface MemoryCascadeSettingsProps {
  settings: ChatSettings
  saving: boolean
  onUpdate: (updates: Partial<MemoryCascadePreferences>) => Promise<void>
}

export function MemoryCascadeSettings({
  settings,
  saving,
  onUpdate,
}: MemoryCascadeSettingsProps) {
  const preferences = settings.memoryCascadePreferences || DEFAULT_MEMORY_CASCADE_PREFERENCES

  const handleDeleteActionChange = (value: MemoryCascadeAction) => {
    onUpdate({ onMessageDelete: value })
  }

  const handleSwipeActionChange = (value: MemoryCascadeAction) => {
    onUpdate({ onSwipeRegenerate: value })
  }

  return (
    <SettingsCard
      title="Memory Cascade Behavior"
      subtitle="Control what happens to auto-extracted memories when you delete or regenerate messages."
    >
      <div className="space-y-6">
        {/* On Message Delete */}
        <div>
          <label className="qt-text-label block mb-2">When deleting a message:</label>
          <select
            value={preferences.onMessageDelete}
            onChange={(e) => handleDeleteActionChange(e.target.value as MemoryCascadeAction)}
            disabled={saving}
            className="qt-select w-full"
          >
            {MEMORY_CASCADE_ACTIONS.map((action) => (
              <option key={action.value} value={action.value}>
                {action.label}
              </option>
            ))}
          </select>
          <p className="qt-text-xs text-muted-foreground mt-1">
            {MEMORY_CASCADE_ACTIONS.find((a) => a.value === preferences.onMessageDelete)?.description}
          </p>
        </div>

        {/* On Swipe Regenerate */}
        <div>
          <label className="qt-text-label block mb-2">When regenerating a response (swipe):</label>
          <select
            value={preferences.onSwipeRegenerate}
            onChange={(e) => handleSwipeActionChange(e.target.value as MemoryCascadeAction)}
            disabled={saving}
            className="qt-select w-full"
          >
            {MEMORY_CASCADE_ACTIONS.filter((a) => a.value !== 'ASK_EVERY_TIME').map((action) => (
              <option key={action.value} value={action.value}>
                {action.label}
              </option>
            ))}
          </select>
          <p className="qt-text-xs text-muted-foreground mt-1">
            {MEMORY_CASCADE_ACTIONS.find((a) => a.value === preferences.onSwipeRegenerate)?.description}
          </p>
        </div>
      </div>
    </SettingsCard>
  )
}
