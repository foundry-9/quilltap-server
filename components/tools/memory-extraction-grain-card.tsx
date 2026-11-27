'use client'

import { useState } from 'react'
import { queryKeys } from '@/lib/query/keys'
import { MEMORY_SETTING_DEFAULTS } from '@/lib/memory/settings-defaults'
import type { MemoryExtractionModeSettings } from '@/lib/schemas/settings.types'
import { useMemorySettingsDocument } from './hooks/useMemorySettingsDocument'
import { MemoryExtractionLimitsSection } from './memory-extraction-limits-section'

type OtherPass = MemoryExtractionModeSettings['otherPass']

const CONFIG_URL = '/api/v1/memories?action=extraction-mode-config'

const OTHER_PASS_OPTIONS: ReadonlyArray<{ value: OtherPass; label: string; description: string }> = [
  {
    value: 'hybrid',
    label: 'Hybrid (recommended)',
    description:
      'Observations of others are gathered when a conversation is folded into its summary, with only the weightiest — commitments, agreements, new standing facts — noted as they happen.',
  },
  {
    value: 'fold',
    label: 'At the fold only',
    description: 'Observations of others are gathered solely when a conversation is folded into its summary. The thriftiest course.',
  },
  {
    value: 'turn',
    label: 'Every turn',
    description: 'Observations of others are noted after each turn, as of old. The most thorough, and the most prone to repeating itself.',
  },
]

/**
 * The grain at which a character's observations of *other* characters are
 * extracted. Instance-wide (`instance_settings['memoryExtractionMode']`).
 */
export function MemoryExtractionGrainCard() {
  const { config, loading: isLoading, saving, error, setError, save } =
    useMemorySettingsDocument<MemoryExtractionModeSettings>({
      queryKey: queryKeys.memories.extractionModeConfig,
      url: CONFIG_URL,
      defaults: MEMORY_SETTING_DEFAULTS.extractionMode,
      noun: 'extraction settings',
    })
  const [floorDraft, setFloorDraft] = useState<string | null>(null)
  const [perSubjectDraft, setPerSubjectDraft] = useState<string | null>(null)

  const commitFloor = () => {
    if (floorDraft === null) return
    const value = Number(floorDraft)
    setFloorDraft(null)
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      setError('The per-turn floor must be between 0 and 1')
      return
    }
    if (value !== config.perTurnOtherFloor) void save({ perTurnOtherFloor: value })
  }

  const commitPerSubject = () => {
    if (perSubjectDraft === null) return
    const value = Number(perSubjectDraft)
    setPerSubjectDraft(null)
    if (!Number.isInteger(value) || value < 1) {
      setError('Candidates per subject must be a whole number of at least 1')
      return
    }
    if (value !== config.foldCandidatesPerSubject) void save({ foldCandidatesPerSubject: value })
  }

  if (isLoading) {
    return <p className="qt-text-small qt-text-muted">Loading extraction settings&hellip;</p>
  }

  const current = OTHER_PASS_OPTIONS.find((o) => o.value === config.otherPass)

  return (
    <div className="space-y-4">
      <p className="qt-text-small qt-text-muted">
        A character&rsquo;s notes about <em>themselves</em> are always taken as the conversation goes. Notes about <em>other</em> characters are another matter: taken every turn, they pile up into a hundred ways of saying the same thing. Choose the grain.
      </p>

      <div className="space-y-1">
        <label htmlFor="extraction-other-pass" className="block qt-text-label">
          Observations of others
        </label>
        <select
          id="extraction-other-pass"
          className="qt-select"
          value={config.otherPass}
          disabled={saving}
          onChange={(e) => void save({ otherPass: e.target.value as OtherPass })}
        >
          {OTHER_PASS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {current && <p className="qt-text-xs qt-text-muted">{current.description}</p>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="extraction-floor" className="block qt-text-label">
            Per-turn importance floor
          </label>
          <input
            id="extraction-floor"
            type="number"
            min={0}
            max={1}
            step={0.05}
            className="qt-input"
            disabled={saving || config.otherPass !== 'hybrid'}
            value={floorDraft ?? String(config.perTurnOtherFloor)}
            onChange={(e) => setFloorDraft(e.target.value)}
            onBlur={commitFloor}
          />
          <p className="qt-text-xs qt-text-muted">In hybrid mode, only observations at or above this importance are noted turn by turn.</p>
        </div>
        <div className="space-y-1">
          <label htmlFor="extraction-per-subject" className="block qt-text-label">
            Fold candidates per subject
          </label>
          <input
            id="extraction-per-subject"
            type="number"
            min={1}
            step={1}
            className="qt-input"
            disabled={saving || config.otherPass === 'turn'}
            value={perSubjectDraft ?? String(config.foldCandidatesPerSubject)}
            onChange={(e) => setPerSubjectDraft(e.target.value)}
            onBlur={commitPerSubject}
          />
          <p className="qt-text-xs qt-text-muted">At a fold, the most notes kept for any one observer and subject.</p>
        </div>
      </div>

      {error && <p className="qt-text-small qt-text-destructive">{error}</p>}

      <div className="pt-4 border-t qt-border-default">
        <MemoryExtractionLimitsSection />
      </div>
    </div>
  )
}
