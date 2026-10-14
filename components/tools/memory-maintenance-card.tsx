'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { MEMORY_CAP_BOUNDS, MEMORY_SETTING_DEFAULTS } from '@/lib/memory/settings-defaults'
import type { MemoryConsolidationSettings, MemoryMaintenanceSettings } from '@/lib/schemas/settings.types'
import { MaintenanceDialog } from '@/components/memory/maintenance-dialog'
import { useMemorySettingsDocument, type MemorySettingsDocument } from './hooks/useMemorySettingsDocument'
import { MemoryConsolidationParticulars } from './memory-consolidation-particulars'
import { MemoryMaintenanceLedger } from './memory-maintenance-ledger'

/**
 * The Maintenance card (memory refactor §3.11, decision 11): one card for the
 * one maintenance job, replacing the Housekeeping, Consolidation and
 * Near-Duplicate Folding cards. Per-phase switches for automatic runs, the
 * cap and its per-character overrides, the consolidation particulars, "Run
 * now" (with a dry run) and the ledger's last outcome per phase.
 */

const MAINTENANCE_URL = '/api/v1/memories?action=maintenance-config'
const CONSOLIDATION_URL = '/api/v1/memories?action=consolidation-config'
const CHARACTER_MEMORY_COUNTS_URL = '/api/v1/memories?action=character-memory-counts'

const CAP_MIN = MEMORY_CAP_BOUNDS.min
const CAP_MAX = MEMORY_CAP_BOUNDS.max

interface CharacterSummary {
  id: string
  name: string
  /** Hot AUTO rows — the only number the cap is measured against (bug 210). */
  demotable: number
  /** Hot MANUAL rows and digests — never demoted, never counted against the cap. */
  protected: number
}

interface CharacterCountsRow {
  id: string
  name: string
  memoryCount?: number
  demotable?: number
  protected?: number
}

export function useCharacterMemoryCounts(): { characters: CharacterSummary[]; loading: boolean } {
  // Decoration for the overrides list and the ledger's names: a failed read
  // leaves them empty rather than failing the card.
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.memories.characterMemoryCounts,
    queryFn: ({ signal }) => apiFetch<{ characters?: unknown }>(CHARACTER_MEMORY_COUNTS_URL, { signal }),
  })
  const raw = data?.characters
  const characters = (Array.isArray(raw) ? raw : []).map((c: CharacterCountsRow) => ({
    id: c.id,
    name: c.name,
    demotable: c.demotable ?? c.memoryCount ?? 0,
    protected: c.protected ?? 0,
  }))
  return { characters, loading: isLoading }
}

function Switch({
  checked,
  disabled,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  disabled: boolean
  onChange: () => void
  label: string
  hint?: React.ReactNode
}) {
  return (
    <label className="flex items-start gap-3 qt-body">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} className="qt-checkbox mt-1" />
      <span>
        <span>{label}</span>
        {hint && <span className="block qt-text-xs qt-text-muted">{hint}</span>}
      </span>
    </label>
  )
}

function PhaseSwitches({
  maintenance,
  consolidation,
}: {
  maintenance: MemorySettingsDocument<MemoryMaintenanceSettings>
  consolidation: MemorySettingsDocument<MemoryConsolidationSettings>
}) {
  const m = maintenance.config
  const c = consolidation.config
  const busy = maintenance.saving || consolidation.saving
  const [retentionDraft, setRetentionDraft] = useState<string | null>(null)

  const togglePhase = (key: keyof MemoryMaintenanceSettings['phases']) =>
    void maintenance.save({ phases: { ...m.phases, [key]: !m.phases[key] } })

  const commitRetention = () => {
    if (retentionDraft === null) return
    const trimmed = retentionDraft.trim()
    setRetentionDraft(null)
    if (trimmed === '') {
      if (c.coldRetentionDays !== null) void consolidation.save({ coldRetentionDays: null })
      return
    }
    const value = Number(trimmed)
    if (!Number.isInteger(value) || value < 1) {
      consolidation.setError('Archive retention must be a whole number of days, or blank for never')
      return
    }
    if (value !== c.coldRetentionDays) void consolidation.save({ coldRetentionDays: value })
  }

  return (
    <div className="space-y-3">
      <Switch
        checked={m.enabled}
        disabled={busy}
        onChange={() => void maintenance.save({ enabled: !m.enabled })}
        label="Enable automatic maintenance"
        hint="A daily round, and a visit whenever a character nears the cap. Off by default — read the limits below first."
      />
      <div className="pl-7 space-y-3">
        <Switch
          checked={m.phases.foldNearDuplicates}
          disabled={busy || !m.enabled}
          onChange={() => togglePhase('foldNearDuplicates')}
          label="Fold near-duplicates"
          hint="Notes that say the same thing about the same occasion are folded into the sturdiest of them, stray details kept as footnotes. No model is consulted."
        />
        <Switch
          checked={c.enabled}
          disabled={busy}
          onChange={() => void consolidation.save({ enabled: !c.enabled })}
          label="Consolidate"
          hint="Once a day, and whenever a character’s unconsidered notes pass the watermark, a model folds clusters of related notes into digests and the originals go to the archive. Has its own switch, as it costs model calls."
        />
        <Switch
          checked={m.phases.demote}
          disabled={busy || !m.enabled}
          onChange={() => togglePhase('demote')}
          label="Demote over the cap"
          hint="Past the cap, the least protected notes — old, unreinforced, unlinked, unconsulted — go to the archive first. Nothing is destroyed."
        />
        <Switch
          checked={m.phases.retire}
          disabled={busy || !m.enabled}
          onChange={() => togglePhase('retire')}
          label="Retire old archive notes"
          hint="Superseded archive notes older than the retention window below are let go for good."
        />
        <div className="flex flex-wrap items-center gap-3 pl-7">
          <label className="qt-text-small qt-text-muted" htmlFor="maintenance-retention">
            Archive retention
          </label>
          <input
            id="maintenance-retention"
            type="number"
            min={1}
            step={1}
            placeholder="never"
            value={retentionDraft ?? (c.coldRetentionDays === null ? '' : String(c.coldRetentionDays))}
            disabled={busy}
            onChange={(e) => setRetentionDraft(e.target.value)}
            onBlur={commitRetention}
            className="qt-input w-28"
          />
          <span className="qt-text-small qt-text-muted">days (blank keeps them forever)</span>
        </div>
        <p className="qt-text-xs qt-text-muted">
          The Commonplace files in each vault are refreshed after every consolidation. Hand-written notes and digests are
          never folded, demoted or let go by any of this.
        </p>
      </div>
    </div>
  )
}

function CapSettings({
  maintenance,
  characters,
}: {
  maintenance: MemorySettingsDocument<MemoryMaintenanceSettings>
  characters: CharacterSummary[]
}) {
  const { config, saving, save, setError } = maintenance
  const [showOverrides, setShowOverrides] = useState(false)
  // The typed cap lives in a draft until blur, so `config` still holds the
  // saved value to compare against (writing it into `config` on every
  // keystroke made the blur think nothing had changed).
  const [capDraft, setCapDraft] = useState<string | null>(null)
  const [overrideDrafts, setOverrideDrafts] = useState<Record<string, string>>({})

  const handleCapBlur = () => {
    if (capDraft === null) return
    const value = Math.floor(Number(capDraft.trim()))
    setCapDraft(null)
    if (capDraft.trim() === '' || !Number.isFinite(value) || value < CAP_MIN || value > CAP_MAX) {
      setError(`The per-character cap must be between ${CAP_MIN.toLocaleString()} and ${CAP_MAX.toLocaleString()}`)
      return
    }
    if (value === config.perCharacterCap) return
    void save({ perCharacterCap: value })
  }

  const handleOverrideBlur = (characterId: string, rawValue: string) => {
    const trimmed = rawValue.trim()
    const nextOverrides: Record<string, number> = { ...config.perCharacterCapOverrides }

    if (trimmed === '') {
      // Empty input removes any override for this character
      if (!(characterId in nextOverrides)) return
      delete nextOverrides[characterId]
    } else {
      const parsed = Math.floor(Number(trimmed))
      if (!Number.isFinite(parsed) || parsed < CAP_MIN || parsed > CAP_MAX) {
        setError(`Override for character ${characterId.slice(0, 8)} must be between ${CAP_MIN.toLocaleString()} and ${CAP_MAX.toLocaleString()}`)
        return
      }
      if (nextOverrides[characterId] === parsed) return
      nextOverrides[characterId] = parsed
    }

    setOverrideDrafts((d) => {
      const next = { ...d }
      delete next[characterId]
      return next
    })
    void save({ perCharacterCapOverrides: nextOverrides })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="qt-text-small qt-text-muted" htmlFor="perCharacterCap">
          Per-character cap
        </label>
        <input
          id="perCharacterCap"
          type="number"
          min={CAP_MIN}
          max={CAP_MAX}
          step={100}
          value={capDraft ?? String(config.perCharacterCap)}
          disabled={saving}
          onChange={(e) => setCapDraft(e.target.value)}
          onBlur={handleCapBlur}
          className="qt-input w-32"
        />
        <span className="qt-text-small qt-text-muted">extracted notes per character</span>
      </div>

      {characters.length > 0 && (
        <div>
          <button
            type="button"
            className="qt-text-small qt-text-muted underline-offset-2 hover:underline"
            onClick={() => setShowOverrides((s) => !s)}
          >
            {showOverrides ? '▾' : '▸'} Per-character overrides ({Object.keys(config.perCharacterCapOverrides).length} active)
          </button>

          {showOverrides && (
            <div className="mt-3 space-y-2">
              <p className="qt-text-small qt-text-muted">
                Set a different cap for individual characters. Leave blank to fall back to the global cap (
                {config.perCharacterCap.toLocaleString()}).
              </p>
              <div className="space-y-1">
                {characters.map((character) => {
                  const override = config.perCharacterCapOverrides[character.id]
                  const draftValue =
                    character.id in overrideDrafts ? overrideDrafts[character.id] : override === undefined ? '' : String(override)
                  const effectiveCap = override ?? config.perCharacterCap
                  const overCap = character.demotable > effectiveCap

                  return (
                    <div key={character.id} className="flex items-center gap-3">
                      <div className="flex-1 qt-body">
                        <span>{character.name}</span>{' '}
                        <span className={overCap ? 'qt-text-destructive qt-text-small' : 'qt-text-muted qt-text-small'}>
                          ({character.demotable.toLocaleString()} counted
                          {character.protected > 0 && <> &middot; {character.protected.toLocaleString()} exempt</>})
                        </span>
                      </div>
                      <input
                        type="number"
                        min={CAP_MIN}
                        max={CAP_MAX}
                        step={100}
                        placeholder={`${config.perCharacterCap}`}
                        value={draftValue}
                        disabled={saving}
                        onChange={(e) => setOverrideDrafts((d) => ({ ...d, [character.id]: e.target.value }))}
                        onBlur={(e) => handleOverrideBlur(character.id, e.target.value)}
                        className="qt-input w-28"
                        aria-label={`Cap override for ${character.name}`}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function MemoryMaintenanceCard() {
  const maintenance = useMemorySettingsDocument<MemoryMaintenanceSettings>({
    queryKey: queryKeys.memories.maintenanceConfig,
    url: MAINTENANCE_URL,
    defaults: MEMORY_SETTING_DEFAULTS.maintenance,
    noun: 'maintenance settings',
  })
  const consolidation = useMemorySettingsDocument<MemoryConsolidationSettings>({
    queryKey: queryKeys.memories.consolidationConfig,
    url: CONSOLIDATION_URL,
    defaults: MEMORY_SETTING_DEFAULTS.consolidation,
    noun: 'consolidation settings',
  })
  const { characters, loading: countsLoading } = useCharacterMemoryCounts()
  const [showDialog, setShowDialog] = useState(false)

  if (maintenance.loading || consolidation.loading || countsLoading) {
    return <p className="qt-text-small qt-text-muted">Loading maintenance settings&hellip;</p>
  }

  const error = maintenance.error ?? consolidation.error

  return (
    <div className="space-y-6">
      <p className="qt-text-small qt-text-muted">
        One round of the household staff tends each character&rsquo;s memories, in a fixed order: repetitions are folded
        together, related notes are consolidated into digests, anything over the cap goes to the archive, and superseded
        archive notes past their retention are let go. Archived notes are not lost: they stay on the shelf, still guard
        against repeats, and return to active duty if the world asks for them again.
      </p>

      <section className="space-y-3">
        <h3 className="qt-text-label">Automatic rounds</h3>
        <PhaseSwitches maintenance={maintenance} consolidation={consolidation} />
      </section>

      <section className="space-y-3 pt-4 border-t qt-border-default">
        <h3 className="qt-text-label">The cap</h3>
        <p className="qt-text-small qt-text-muted">
          Only extracted notes in active service count. Maintenance calls when a character reaches nine-tenths of it.
        </p>
        <CapSettings maintenance={maintenance} characters={characters} />
      </section>

      <section className="space-y-3 pt-4 border-t qt-border-default">
        <MemoryConsolidationParticulars consolidation={consolidation} />
      </section>

      <section className="space-y-3 pt-4 border-t qt-border-default">
        <h3 className="qt-text-label">Run now</h3>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="qt-button qt-button-secondary" onClick={() => setShowDialog(true)}>
            Run maintenance&hellip;
          </button>
          <span className="qt-text-small qt-text-muted">One character or every one, any phases, with a dry run first.</span>
        </div>
      </section>

      <section className="space-y-3 pt-4 border-t qt-border-default">
        <h3 className="qt-text-label">The ledger</h3>
        <MemoryMaintenanceLedger characters={characters} />
      </section>

      {error && <p className="qt-text-small qt-text-destructive">{error}</p>}

      {showDialog && <MaintenanceDialog onClose={() => setShowDialog(false)} />}
    </div>
  )
}
