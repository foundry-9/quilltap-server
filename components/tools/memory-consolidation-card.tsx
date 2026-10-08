'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useConnectionProfiles } from '@/hooks/useConnectionProfiles'
import type { ConsolidationReport } from '@/lib/memory/consolidation'
import { readErrorText, writeErrorText } from './hooks/api-error-text'
import { MemoryConsolidationReportDialog } from './memory-consolidation-report-dialog'

interface ConsolidationConfig {
  enabled: boolean
  connectionProfileId: string | null
  clusterThreshold: number
  minClusterSize: number
  maxClusterSize: number
  matureAfterDays: number
  maxClustersPerRun: number
  watermark: number
  coldRetentionDays: number | null
}

const DEFAULT_CONFIG: ConsolidationConfig = {
  enabled: false,
  connectionProfileId: null,
  clusterThreshold: 0.72,
  minClusterSize: 3,
  maxClusterSize: 30,
  matureAfterDays: 7,
  maxClustersPerRun: 40,
  watermark: 150,
  coldRetentionDays: null,
}

interface CharacterSummary {
  id: string
  name: string
  memoryCount: number
}

const CONFIG_URL = '/api/v1/memories?action=consolidation-config'
const CONSOLIDATE_URL = '/api/v1/memories?action=consolidate'
const CHARACTER_MEMORY_COUNTS_URL = '/api/v1/memories?action=character-memory-counts'

type NumericKey = Exclude<keyof ConsolidationConfig, 'enabled' | 'connectionProfileId'>

interface NumberFieldSpec {
  key: NumericKey
  label: string
  help: string
  min: number
  max?: number
  step: number
  integer: boolean
  nullable?: boolean
}

const NUMBER_FIELDS: ReadonlyArray<NumberFieldSpec> = [
  { key: 'clusterThreshold', label: 'Cluster threshold', help: 'How alike two notes must be (0 to 1, by cosine) to be folded together.', min: 0, max: 1, step: 0.01, integer: false },
  { key: 'minClusterSize', label: 'Smallest cluster', help: 'Fewest notes worth a digest. Falls to two when one of them is quite old.', min: 2, step: 1, integer: true },
  { key: 'maxClusterSize', label: 'Largest cluster', help: 'Most notes put before the model in one sitting.', min: 2, step: 1, integer: true },
  { key: 'matureAfterDays', label: 'Mature after (days)', help: 'Notes younger than this are left to settle.', min: 0, step: 1, integer: false },
  { key: 'maxClustersPerRun', label: 'Clusters per run', help: 'Bounds the cost of a run; a backlog drains over several.', min: 1, step: 1, integer: true },
  { key: 'watermark', label: 'Watermark', help: 'Unconsidered active notes at which a character is queued automatically.', min: 1, step: 1, integer: true },
  { key: 'coldRetentionDays', label: 'Archive retention (days)', help: 'Delete superseded archived notes older than this. Leave blank to keep them forever.', min: 1, step: 1, integer: true, nullable: true },
]

/**
 * Consolidation: folds clusters of active memories into digests and sends the
 * originals to the archive. Instance-wide settings in
 * `instance_settings['memoryConsolidation']`, plus the manual
 * "consolidate now" for one character (dry run in-process, real run queued).
 */
export function MemoryConsolidationCard() {
  const queryClient = useQueryClient()
  const { profiles } = useConnectionProfiles()
  const [config, setConfig] = useState<ConsolidationConfig>(DEFAULT_CONFIG)
  const [drafts, setDrafts] = useState<Partial<Record<NumericKey, string>>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [characterId, setCharacterId] = useState('')
  const [running, setRunning] = useState<'dry' | 'real' | null>(null)
  const [report, setReport] = useState<ConsolidationReport | null>(null)

  const { data: loaded, isLoading: configLoading, error: loadError } = useQuery({
    queryKey: queryKeys.memories.consolidationConfig,
    queryFn: ({ signal }) => apiFetch<{ settings?: Partial<ConsolidationConfig> }>(CONFIG_URL, { signal }),
  })

  const { data: loadedCounts } = useQuery({
    queryKey: queryKeys.memories.characterMemoryCounts,
    queryFn: ({ signal }) => apiFetch<{ characters?: unknown }>(CHARACTER_MEMORY_COUNTS_URL, { signal }),
  })
  const rawCharacters = loadedCounts?.characters
  const characters: CharacterSummary[] = Array.isArray(rawCharacters) ? rawCharacters : []

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the form is local state seeded from the query
    if (loaded?.settings) setConfig({ ...DEFAULT_CONFIG, ...loaded.settings })
  }, [loaded])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- surface the read failure in the shared error line
    if (loadError) setError(readErrorText(loadError, 'Failed to load consolidation settings'))
  }, [loadError])

  const saveConfig = async (patch: Partial<ConsolidationConfig>) => {
    setSaving(true)
    setError(null)
    try {
      const data = await apiFetch<{ settings: ConsolidationConfig }>(CONFIG_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      setConfig({ ...DEFAULT_CONFIG, ...data.settings })
      void queryClient.invalidateQueries({ queryKey: queryKeys.memories.consolidationConfig })
      showSuccessToast('Consolidation settings saved')
    } catch (err) {
      const msg = writeErrorText(err, 'Failed to save consolidation settings')
      setError(msg)
      showErrorToast(msg)
    } finally {
      setSaving(false)
    }
  }

  const commitNumber = (spec: NumberFieldSpec) => {
    const raw = drafts[spec.key]
    if (raw === undefined) return
    const clearDraft = () =>
      setDrafts((d) => {
        const next = { ...d }
        delete next[spec.key]
        return next
      })
    const trimmed = raw.trim()
    if (trimmed === '') {
      clearDraft()
      if (spec.nullable && config[spec.key] !== null) void saveConfig({ [spec.key]: null })
      return
    }
    const value = Number(trimmed)
    const outOfRange = !Number.isFinite(value) || value < spec.min || (spec.max !== undefined && value > spec.max)
    if (outOfRange || (spec.integer && !Number.isInteger(value))) {
      setError(`${spec.label} must be ${spec.integer ? 'a whole number' : 'a number'} ${spec.max !== undefined ? `between ${spec.min} and ${spec.max}` : `of at least ${spec.min}`}`)
      return
    }
    clearDraft()
    if (value === config[spec.key]) return
    void saveConfig({ [spec.key]: value })
  }

  const consolidate = async (dryRun: boolean) => {
    if (!characterId) return
    setRunning(dryRun ? 'dry' : 'real')
    setError(null)
    try {
      const data = await apiFetch<{ report?: ConsolidationReport; jobId?: string }>(CONSOLIDATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId, dryRun }),
      })
      if (dryRun && data.report) {
        setReport(data.report)
      } else {
        showSuccessToast('The consolidation has been sent below stairs — it will run in the background')
      }
    } catch (err) {
      const msg = writeErrorText(err, dryRun ? 'The rehearsal failed' : 'Failed to queue consolidation')
      setError(msg)
      showErrorToast(msg)
    } finally {
      setRunning(null)
    }
  }

  if (configLoading) {
    return <p className="qt-text-small qt-text-muted">Loading consolidation settings&hellip;</p>
  }

  const busy = saving || running !== null
  const selectedProfileMissing =
    config.connectionProfileId !== null && !profiles.some((p) => p.id === config.connectionProfileId)

  return (
    <div className="space-y-4">
      <p className="qt-text-small qt-text-muted">
        Consolidation folds clusters of near-duplicate memories into a single, denser digest, and sends the originals to the archive, where they keep for reference and are labelled as superseded. Recall then reads the digests rather than the pile. It runs once a day and whenever a character&rsquo;s unconsidered notes pass the watermark &mdash; once switched on. A capable model does this better than the cheap one. Off by default.
      </p>

      <label className="flex items-center gap-3 qt-body">
        <input
          type="checkbox"
          checked={config.enabled}
          disabled={busy}
          onChange={() => void saveConfig({ enabled: !config.enabled })}
          className="qt-checkbox"
        />
        <span>Enable automatic consolidation</span>
      </label>

      <div className="space-y-1">
        <label htmlFor="consolidation-profile" className="block qt-text-label">
          Connection profile
        </label>
        <select
          id="consolidation-profile"
          className="qt-select"
          value={config.connectionProfileId ?? ''}
          disabled={busy}
          onChange={(e) => void saveConfig({ connectionProfileId: e.target.value || null })}
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
        <p className="qt-text-xs qt-text-muted">A capable model is recommended for the first, large backfill.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {NUMBER_FIELDS.map((spec) => {
          const stored = config[spec.key]
          const value = drafts[spec.key] ?? (stored === null ? '' : String(stored))
          return (
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
                value={value}
                placeholder={spec.nullable ? 'never' : undefined}
                disabled={busy}
                onChange={(e) => setDrafts((d) => ({ ...d, [spec.key]: e.target.value }))}
                onBlur={() => commitNumber(spec)}
                className="qt-input"
              />
              <p className="qt-text-xs qt-text-muted">{spec.help}</p>
            </div>
          )
        })}
      </div>

      <div className="space-y-2 pt-2 border-t qt-border-default">
        <p className="qt-text-label">Consolidate now</p>
        <p className="qt-text-small qt-text-muted">
          Choose a character. A dry run rehearses a handful of clusters and shows the proposed digests without writing a thing; the real run is queued in the background and ignores the master switch above.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="Character to consolidate"
            className="qt-select w-auto"
            value={characterId}
            disabled={busy}
            onChange={(e) => setCharacterId(e.target.value)}
          >
            <option value="">Choose a character&hellip;</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.memoryCount.toLocaleString()} memories)
              </option>
            ))}
          </select>
          <button
            type="button"
            className="qt-button qt-button-secondary"
            disabled={busy || !characterId}
            onClick={() => void consolidate(true)}
          >
            {running === 'dry' ? 'Rehearsing…' : 'Dry run'}
          </button>
          <button
            type="button"
            className="qt-button qt-button-primary"
            disabled={busy || !characterId}
            onClick={() => void consolidate(false)}
          >
            {running === 'real' ? 'Queuing…' : 'Consolidate for real'}
          </button>
        </div>
      </div>

      {error && <p className="qt-text-small qt-text-destructive">{error}</p>}

      {report && <MemoryConsolidationReportDialog report={report} onClose={() => setReport(null)} />}
    </div>
  )
}
