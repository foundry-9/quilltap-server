'use client'

import { useState } from 'react'
import { useConnectionProfiles } from '@/hooks/useConnectionProfiles'
import type { MemoryConsolidationSettings } from '@/lib/schemas/settings.types'
import type { MemorySettingsDocument } from './hooks/useMemorySettingsDocument'

/**
 * The consolidation phase's particulars on the Maintenance card: which model
 * does the folding and how alike notes must be to share a digest. Its on/off
 * switch and the archive retention sit with the other phase switches.
 */

type NumericKey = 'clusterThreshold' | 'tfidfClusterThreshold' | 'minClusterSize' | 'maxClusterSize' | 'matureAfterDays' | 'maxClustersPerRun' | 'watermark'

interface NumberFieldSpec {
  key: NumericKey
  label: string
  help: string
  min: number
  max?: number
  step: number
  integer: boolean
}

const NUMBER_FIELDS: ReadonlyArray<NumberFieldSpec> = [
  { key: 'clusterThreshold', label: 'Cluster threshold', help: 'How alike two notes must be (0 to 1, by cosine) to be folded together.', min: 0, max: 1, step: 0.01, integer: false },
  { key: 'tfidfClusterThreshold', label: 'Cluster threshold (Built-in)', help: 'The same measure when the default embedding profile is the Built-in TF-IDF one, which reckons likeness far more sparingly.', min: 0, max: 1, step: 0.01, integer: false },
  { key: 'minClusterSize', label: 'Smallest cluster', help: 'Fewest notes worth a digest. Falls to two when one of them is quite old.', min: 2, step: 1, integer: true },
  { key: 'maxClusterSize', label: 'Largest cluster', help: 'Most notes put before the model in one sitting.', min: 2, step: 1, integer: true },
  { key: 'matureAfterDays', label: 'Mature after (days)', help: 'Notes younger than this are left to settle.', min: 0, step: 1, integer: false },
  { key: 'maxClustersPerRun', label: 'Clusters per run', help: 'Bounds the cost of a run; a backlog drains over several.', min: 1, step: 1, integer: true },
  { key: 'watermark', label: 'Watermark', help: 'Unconsidered active notes at which a character is queued automatically.', min: 1, step: 1, integer: true },
]

export function MemoryConsolidationParticulars({ consolidation }: { consolidation: MemorySettingsDocument<MemoryConsolidationSettings> }) {
  const { profiles } = useConnectionProfiles()
  const { config, saving, save, setError } = consolidation
  const [open, setOpen] = useState(false)
  const [drafts, setDrafts] = useState<Partial<Record<NumericKey, string>>>({})

  const commitNumber = (spec: NumberFieldSpec) => {
    const raw = drafts[spec.key]
    if (raw === undefined) return
    setDrafts((d) => {
      const next = { ...d }
      delete next[spec.key]
      return next
    })
    const value = Number(raw.trim())
    const outOfRange = raw.trim() === '' || !Number.isFinite(value) || value < spec.min || (spec.max !== undefined && value > spec.max)
    if (outOfRange || (spec.integer && !Number.isInteger(value))) {
      setError(`${spec.label} must be ${spec.integer ? 'a whole number' : 'a number'} ${spec.max !== undefined ? `between ${spec.min} and ${spec.max}` : `of at least ${spec.min}`}`)
      return
    }
    if (value !== config[spec.key]) void save({ [spec.key]: value })
  }

  const selectedProfileMissing =
    config.connectionProfileId !== null && !profiles.some((p) => p.id === config.connectionProfileId)

  return (
    <div className="space-y-3">
      <button
        type="button"
        className="qt-text-label underline-offset-2 hover:underline"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? '▾' : '▸'} Consolidation particulars
      </button>

      {open && (
        <div className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="consolidation-profile" className="block qt-text-label">
              Connection profile
            </label>
            <select
              id="consolidation-profile"
              className="qt-select"
              value={config.connectionProfileId ?? ''}
              disabled={saving}
              onChange={(e) => void save({ connectionProfileId: e.target.value || null })}
            >
              <option value="">The cheap LLM (default)</option>
              {selectedProfileMissing && <option value={config.connectionProfileId ?? ''}>(a profile that has since left the building)</option>}
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.provider}
                  {p.modelName ? ` • ${p.modelName}` : ''})
                </option>
              ))}
            </select>
            <p className="qt-text-xs qt-text-muted">A capable model does this better than the cheap one, and is recommended for the first, large backfill.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {NUMBER_FIELDS.map((spec) => (
              <div key={spec.key} className="space-y-1">
                <label htmlFor={`consolidation-${spec.key}`} className="block qt-text-label">
                  {spec.label}
                </label>
                <input
                  id={`consolidation-${spec.key}`}
                  type="number"
                  min={spec.min}
                  max={spec.max}
                  step={spec.step}
                  value={drafts[spec.key] ?? String(config[spec.key])}
                  disabled={saving}
                  onChange={(e) => setDrafts((d) => ({ ...d, [spec.key]: e.target.value }))}
                  onBlur={() => commitNumber(spec)}
                  className="qt-input"
                />
                <p className="qt-text-xs qt-text-muted">{spec.help}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
