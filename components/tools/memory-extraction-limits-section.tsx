'use client'

import { useState } from 'react'
import { queryKeys } from '@/lib/query/keys'
import { MEMORY_SETTING_DEFAULTS } from '@/lib/memory/settings-defaults'
import type { MemoryExtractionLimits } from '@/lib/schemas/settings.types'
import { useMemorySettingsDocument } from './hooks/useMemorySettingsDocument'

/**
 * The extraction rate limiter (`instance_settings['memoryExtractionLimits']`),
 * on the Extraction Grain card. When a character's new notes in the past hour
 * approach `maxPerHour`, only the weightier candidates are kept; at the limit,
 * extraction pauses for that character until the hour rolls on.
 */

const LIMITS_URL = '/api/v1/memories?action=extraction-limits-config'

type NumericKey = 'maxPerHour' | 'softStartFraction' | 'softFloor'

const FIELDS: ReadonlyArray<{ key: NumericKey; label: string; help: string; min: number; max?: number; step: number; integer: boolean }> = [
  { key: 'maxPerHour', label: 'Notes per hour', help: 'The most new notes one character may take in an hour.', min: 1, max: 10_000, step: 1, integer: true },
  { key: 'softStartFraction', label: 'Begin choosing at', help: 'The share of the hourly limit (0 to 1) past which only weightier notes are kept.', min: 0, max: 1, step: 0.05, integer: false },
  { key: 'softFloor', label: 'Importance floor', help: 'Past that point, the least importance a new note must carry (0 to 1).', min: 0, max: 1, step: 0.05, integer: false },
]

export function MemoryExtractionLimitsSection() {
  const { config, loading, saving, save, error, setError } = useMemorySettingsDocument<MemoryExtractionLimits>({
    queryKey: queryKeys.memories.extractionLimitsConfig,
    url: LIMITS_URL,
    defaults: MEMORY_SETTING_DEFAULTS.extractionLimits,
    noun: 'extraction limits',
  })
  const [drafts, setDrafts] = useState<Partial<Record<NumericKey, string>>>({})

  if (loading) return <p className="qt-text-small qt-text-muted">Loading extraction limits&hellip;</p>

  const commit = (field: (typeof FIELDS)[number]) => {
    const raw = drafts[field.key]
    if (raw === undefined) return
    setDrafts((d) => {
      const next = { ...d }
      delete next[field.key]
      return next
    })
    const value = Number(raw.trim())
    const bad = raw.trim() === '' || !Number.isFinite(value) || value < field.min || (field.max !== undefined && value > field.max) || (field.integer && !Number.isInteger(value))
    if (bad) {
      setError(`${field.label} must be ${field.integer ? 'a whole number' : 'a number'} between ${field.min} and ${field.max}`)
      return
    }
    if (value !== config[field.key]) void save({ [field.key]: value })
  }

  return (
    <div className="space-y-3">
      <h3 className="qt-text-label">Rate limits</h3>
      <label className="flex items-start gap-3 qt-body">
        <input
          type="checkbox"
          className="qt-checkbox mt-1"
          checked={config.enabled}
          disabled={saving}
          onChange={() => void save({ enabled: !config.enabled })}
        />
        <span>
          <span>Limit how quickly a character takes notes</span>
          <span className="block qt-text-xs qt-text-muted">
            A guard against a long, busy evening filling the shelves. Off by default.
          </span>
        </span>
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        {FIELDS.map((field) => (
          <div key={field.key} className="space-y-1">
            <label htmlFor={`extraction-limits-${field.key}`} className="block qt-text-label">
              {field.label}
            </label>
            <input
              id={`extraction-limits-${field.key}`}
              type="number"
              min={field.min}
              max={field.max}
              step={field.step}
              className="qt-input"
              disabled={saving || !config.enabled}
              value={drafts[field.key] ?? String(config[field.key])}
              onChange={(e) => setDrafts((d) => ({ ...d, [field.key]: e.target.value }))}
              onBlur={() => commit(field)}
            />
            <p className="qt-text-xs qt-text-muted">{field.help}</p>
          </div>
        ))}
      </div>
      {error && <p className="qt-text-small qt-text-destructive">{error}</p>}
    </div>
  )
}
