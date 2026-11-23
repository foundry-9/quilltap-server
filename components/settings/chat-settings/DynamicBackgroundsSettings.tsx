'use client'

/**
 * Dynamic Backgrounds — the instance-wide switch for the changing collage the
 * house hangs behind the home, project and character pages
 * (`chatSettings.dynamicBackgrounds`), whether pictures drawn by an
 * uncensored profile may join it, and how many minutes each collage stays up.
 *
 * The uncensored decision is enforced on the server
 * (`lib/dynamic-backgrounds/eligibility.ts`); this card only records the
 * operator's choice.
 *
 * @module components/settings/chat-settings/DynamicBackgroundsSettings
 */

import { useCallback } from 'react'
import { SettingsCard } from '@/components/ui/SettingsCard'
import { useDraft } from '@/lib/hooks/use-draft'
import {
  DYNAMIC_BACKGROUND_REFRESH_MAX,
  DYNAMIC_BACKGROUND_REFRESH_MIN,
} from '@/lib/schemas/settings.types'
import type { ChatSettings, DynamicBackgroundsSettings as DynamicBackgroundsSettingsValue } from './types'
import { DEFAULT_DYNAMIC_BACKGROUNDS_SETTINGS } from './types'

export interface DynamicBackgroundsSettingsProps {
  settings: ChatSettings
  saving: boolean
  onChange: (updates: Partial<DynamicBackgroundsSettingsValue>) => Promise<void>
}

/** A typed interval clamped into bounds, or null when it is not a whole number. */
export function parseRefreshMinutes(text: string): number | null {
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number.parseInt(trimmed, 10)
  return Math.min(DYNAMIC_BACKGROUND_REFRESH_MAX, Math.max(DYNAMIC_BACKGROUND_REFRESH_MIN, value))
}

export function DynamicBackgroundsSettings({ settings, saving, onChange }: DynamicBackgroundsSettingsProps) {
  const current = { ...DEFAULT_DYNAMIC_BACKGROUNDS_SETTINGS, ...settings.dynamicBackgrounds }

  // The typed interval is a draft, so a refetch never overwrites what is being typed (#170).
  const [minutesText, setMinutesText, minutesDraft] = useDraft(String(current.refreshMinutes))

  const commitMinutes = useCallback(() => {
    const parsed = parseRefreshMinutes(minutesText)
    if (parsed === null) {
      minutesDraft.reset()
      return
    }
    setMinutesText(String(parsed))
    if (parsed !== current.refreshMinutes) {
      void onChange({ refreshMinutes: parsed })
    }
  }, [minutesText, minutesDraft, setMinutesText, current.refreshMinutes, onChange])

  return (
    <SettingsCard
      title="Dynamic Backgrounds"
      subtitle="A changing collage of your own pictures behind the home, project and character pages"
    >
      <div className="space-y-6">
        <div className="flex items-start gap-3 p-4 border qt-border-default rounded">
          <input
            id="dynamic-backgrounds-enabled"
            type="checkbox"
            checked={current.enabled}
            onChange={(e) => void onChange({ enabled: e.target.checked })}
            disabled={saving}
            className="qt-checkbox mt-1"
          />
          <div className="flex-1">
            <label htmlFor="dynamic-backgrounds-enabled" className="font-medium qt-text cursor-pointer">
              Dynamic backgrounds
            </label>
            <div className="qt-text-small mt-1">
              Have the house paper the walls of the home parlour, each project and each character
              with a collage of the pictures already painted for them — story backgrounds for the
              first two, avatar sittings for the third — and rehang it every few minutes. Fewer
              than three pictures, and the walls stay as they are.
            </div>
          </div>
        </div>

        {current.enabled && (
          <>
            <div className="flex items-start gap-3 p-4 border qt-border-default rounded">
              <input
                id="dynamic-backgrounds-allow-uncensored"
                type="checkbox"
                checked={current.allowUncensored}
                onChange={(e) => void onChange({ allowUncensored: e.target.checked })}
                disabled={saving}
                className="qt-checkbox mt-1"
              />
              <div className="flex-1">
                <label htmlFor="dynamic-backgrounds-allow-uncensored" className="font-medium qt-text cursor-pointer">
                  Allow uncensored images
                </label>
                <div className="qt-text-small mt-1">
                  Let pictures drawn at the Concierge&apos;s uncensored desk onto the walls. With this
                  off, they are kept in the back room. Pictures painted before Quilltap 4.14 carry no
                  record of which desk drew them; those are left out only when a chat they belong to
                  is Unmoderated or was flagged — a guess, and an imperfect one.
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="dynamic-backgrounds-refresh-minutes" className="block font-medium qt-text">
                Minutes between changes
              </label>
              <p className="qt-text-small">
                How long each collage hangs before the staff take it down and put up another
                ({DYNAMIC_BACKGROUND_REFRESH_MIN}–{DYNAMIC_BACKGROUND_REFRESH_MAX}).
              </p>
              <input
                id="dynamic-backgrounds-refresh-minutes"
                type="number"
                inputMode="numeric"
                min={DYNAMIC_BACKGROUND_REFRESH_MIN}
                max={DYNAMIC_BACKGROUND_REFRESH_MAX}
                step={1}
                value={minutesText}
                onChange={(e) => setMinutesText(e.target.value)}
                onBlur={commitMinutes}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitMinutes()
                  }
                }}
                disabled={saving}
                className="qt-input w-32"
              />
            </div>
          </>
        )}
      </div>
    </SettingsCard>
  )
}
