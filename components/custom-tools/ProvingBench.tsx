'use client'

/**
 * ProvingBench — the Workbench's right-hand panel: single dry-run rolls, the
 * fact sheet, the Monte Carlo table audit, and the live JSON preview.
 *
 * Rolls and audits execute SERVER-SIDE through the same `executeCustomTool`
 * core a live chat uses (the preview/audit actions on `/api/v1/custom-tools`),
 * so the bench can never drift from what the table would actually deal. The
 * bench posts nothing and writes nothing.
 */

import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Icon } from '@/components/ui/icon'
import { apiFetch, ApiFetchError } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { displayTitle } from '@/lib/pascal/custom-tool.types'
import type { CustomToolAuditResult, CustomToolRunResult } from '@/lib/pascal/custom-tools'
import { definitionFromDraft, type ToolDraft } from '@/lib/pascal/tool-draft'
import {
  CustomToolParamsForm,
  coerceParamValues,
  initialParamValues,
  type CustomToolParameterSpec,
  type ParameterFormValues,
} from './CustomToolParamsForm'

interface ProvingBenchProps {
  draft: ToolDraft
  /** False while the draft has blocking errors — Roll/Audit disable with a hint. */
  valid: boolean
  /** Reports which outcome row a bench roll landed on, for the form's flash. */
  onMatched?: (outcomeId: string | null) => void
}

/** A character eligible to lend the bench its fact sheet. */
interface BenchCharacter {
  id: string
  name: string
}

/** The fact sheet, in one of its two modes (§4.5 card 2). */
type FactSheet =
  | { mode: 'character'; characterId: string }
  | { mode: 'manual'; text: string }

function extractErrorMessage(err: unknown): string {
  if (err instanceof ApiFetchError) {
    const info = err.info
    if (info && typeof info === 'object' && typeof (info as { error?: unknown }).error === 'string') {
      return (info as { error: string }).error
    }
    return err.message
  }
  if (err instanceof Error) return err.message
  return 'The bench could not oblige.'
}

export function ProvingBench({ draft, valid, onMatched }: Readonly<ProvingBenchProps>) {
  const paramSpecs = useMemo(() => {
    const specs: Record<string, CustomToolParameterSpec> = {}
    for (const param of draft.parameters) {
      if (!param.name) continue
      const numeric = param.type === 'number' || param.type === 'integer'
      specs[param.name] = {
        type: param.type,
        default: param.type === 'boolean' ? Boolean(param.defaultValue) : numeric ? Number(param.defaultValue) || 0 : String(param.defaultValue),
        description: param.description || undefined,
        min: numeric && param.min.trim() !== '' ? Number(param.min) : undefined,
        max: numeric && param.max.trim() !== '' ? Number(param.max) : undefined,
      }
    }
    return specs
  }, [draft.parameters])

  const [values, setValues] = useState<ParameterFormValues>({})
  const [isPrivate, setIsPrivate] = useState(false)
  const [sheet, setSheet] = useState<FactSheet>({ mode: 'manual', text: '{}' })
  const [rolls, setRolls] = useState<CustomToolRunResult[]>([])
  const [audit, setAudit] = useState<CustomToolAuditResult | null>(null)

  // Merge declared defaults under whatever the user has touched, so a fresh
  // parameter shows up pre-filled without wiping edits to the others.
  const effectiveValues = useMemo(
    () => ({ ...initialParamValues(paramSpecs), ...values }),
    [paramSpecs, values]
  )

  const testsMetadata = draft.outcomes.some((o) => o.conditions.some((c) => c.subject.kind === 'metadata'))

  const manualSheetError = useMemo(() => {
    if (sheet.mode !== 'manual') return null
    try {
      const parsed = JSON.parse(sheet.text)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return 'The fact sheet must be a single JSON object.'
      }
      return null
    } catch {
      return 'The fact sheet is not valid JSON.'
    }
  }, [sheet])

  const charactersQuery = useQuery({
    queryKey: queryKeys.customTools.destinations(),
    queryFn: ({ signal }) =>
      apiFetch<{ characters: Array<{ characterId: string; characterName: string }> }>(
        '/api/v1/custom-tools?action=destinations',
        { signal }
      ),
    enabled: sheet.mode === 'character',
    select: (data): BenchCharacter[] =>
      data.characters.map((c) => ({ id: c.characterId, name: c.characterName })),
  })

  const benchMetadata = (): Record<string, unknown> | { characterId: string } | undefined => {
    if (sheet.mode === 'character') return sheet.characterId ? { characterId: sheet.characterId } : undefined
    try {
      const parsed = JSON.parse(sheet.text)
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined
    } catch {
      return undefined
    }
  }

  const rollMutation = useMutation({
    mutationFn: () =>
      apiFetch<CustomToolRunResult>('/api/v1/custom-tools?action=preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          definition: definitionFromDraft(draft),
          params: coerceParamValues(paramSpecs, effectiveValues),
          private: isPrivate,
          metadata: benchMetadata(),
        }),
      }),
    onSuccess: (result) => {
      setRolls((prev) => [result, ...prev].slice(0, 10))
      onMatched?.(draft.outcomes[result.outcomeIndex]?.id ?? null)
    },
  })

  const auditMutation = useMutation({
    mutationFn: () =>
      apiFetch<CustomToolAuditResult>('/api/v1/custom-tools?action=audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          definition: definitionFromDraft(draft),
          params: coerceParamValues(paramSpecs, effectiveValues),
          metadata: benchMetadata(),
        }),
      }),
    onSuccess: setAudit,
  })

  const benchDisabled = !valid || (sheet.mode === 'manual' && manualSheetError !== null)
  const jsonPreview = useMemo(() => `${JSON.stringify(definitionFromDraft(draft), null, 2)}\n`, [draft])

  return (
    <div className="space-y-3">
      {/* Card 1 — Test roll */}
      <section className="qt-card p-3 space-y-2">
        <h3 className="qt-card-title text-sm">The proving bench</h3>
        <div className="space-y-2">
          <CustomToolParamsForm
            parameters={paramSpecs}
            values={effectiveValues}
            onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))}
            disabled={rollMutation.isPending}
            idPrefix="bench"
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="qt-checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
            />
            Roll privately
          </label>
          <button
            type="button"
            className="qt-button qt-button-primary qt-button-sm w-full"
            onClick={() => rollMutation.mutate()}
            disabled={benchDisabled || rollMutation.isPending}
            title={benchDisabled ? 'The draft must be valid before the bench will deal' : undefined}
          >
            <Icon name="play" className="w-3.5 h-3.5" />
            {rollMutation.isPending ? 'Rolling…' : 'Roll'}
          </button>
          {rollMutation.isError && (
            <p className="text-xs qt-text-destructive">{extractErrorMessage(rollMutation.error)}</p>
          )}
        </div>

        {rolls.map((roll, index) => (
          <MiniPascalBubble key={`${roll.raw}-${roll.value}-${index}`} roll={roll} draft={draft} faded={index > 0} />
        ))}
      </section>

      {/* Card 2 — The fact sheet */}
      <section className="qt-card p-3 space-y-2">
        <h3 className="qt-card-title text-sm">The fact sheet</h3>
        <p className="qt-hint">
          Metadata tests read the invoking character&rsquo;s <code>metadata.json</code>. Lend the bench a sheet, or it
          rolls as nobody in particular.
        </p>
        <div className="flex rounded overflow-hidden border w-fit" role="radiogroup" aria-label="Fact sheet mode">
          <button
            type="button"
            role="radio"
            aria-checked={sheet.mode === 'character'}
            className={`px-2 py-1 text-xs ${sheet.mode === 'character' ? 'qt-button qt-button-primary' : 'qt-button qt-button-ghost'}`}
            onClick={() => setSheet({ mode: 'character', characterId: '' })}
          >
            Pick a character
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={sheet.mode === 'manual'}
            className={`px-2 py-1 text-xs ${sheet.mode === 'manual' ? 'qt-button qt-button-primary' : 'qt-button qt-button-ghost'}`}
            onClick={() => setSheet({ mode: 'manual', text: '{}' })}
          >
            Hand-typed sheet
          </button>
        </div>

        {sheet.mode === 'character' ? (
          <select
            value={sheet.characterId}
            onChange={(e) => setSheet({ mode: 'character', characterId: e.target.value })}
            className="qt-select qt-select-sm w-full"
            aria-label="Character whose fact sheet to use"
          >
            <option value="">— nobody in particular —</option>
            {(charactersQuery.data ?? []).map((character) => (
              <option key={character.id} value={character.id}>
                {character.name}
              </option>
            ))}
          </select>
        ) : (
          <div>
            <textarea
              value={sheet.text}
              onChange={(e) => setSheet({ mode: 'manual', text: e.target.value })}
              rows={3}
              className={`qt-textarea w-full font-mono text-xs ${manualSheetError ? 'qt-input-error' : ''}`}
              aria-label="Hand-typed fact sheet (JSON object)"
              spellCheck={false}
            />
            {manualSheetError && <p className="text-xs qt-text-destructive">{manualSheetError}</p>}
          </div>
        )}

        {testsMetadata &&
          ((sheet.mode === 'manual' && sheet.text.trim().replace(/\s/g, '') === '{}') ||
            (sheet.mode === 'character' && !sheet.characterId)) && (
            <p className="text-xs qt-text-secondary">
              No fact sheet supplied — metadata tests will all decline, exactly as for an unattributed manual roll.
            </p>
          )}
      </section>

      {/* Card 3 — Table audit */}
      <section className="qt-card p-3 space-y-2">
        <h3 className="qt-card-title text-sm">The audit</h3>
        <button
          type="button"
          className="qt-button qt-button-secondary qt-button-sm w-full"
          onClick={() => auditMutation.mutate()}
          disabled={benchDisabled || auditMutation.isPending}
          title={benchDisabled ? 'The draft must be valid before the house will audit it' : undefined}
        >
          {auditMutation.isPending ? 'Dealing…' : 'Deal a thousand hands'}
        </button>
        {auditMutation.isError && (
          <p className="text-xs qt-text-destructive">{extractErrorMessage(auditMutation.error)}</p>
        )}

        {audit && (
          <div className="space-y-1">
            <p className="text-xs qt-text-secondary">
              {audit.runs.toLocaleString()} draws · values {formatShort(audit.valueMin)}–{formatShort(audit.valueMax)} ·
              mean {formatShort(audit.valueMean)}
            </p>
            {audit.outcomes.map((entry) => {
              const outcome = draft.outcomes[entry.index]
              const label = outcome?.catchAll ? 'otherwise' : `row ${entry.index + 1}`
              return (
                <div key={entry.index} className="space-y-0.5">
                  <div className="flex justify-between text-xs">
                    <span>
                      {label} <span className="qt-text-secondary">({outcome?.state ?? '?'})</span>
                    </span>
                    <span>{(entry.share * 100).toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 rounded qt-bg-muted overflow-hidden">
                    <div
                      className="h-full rounded"
                      style={{
                        width: `${Math.max(entry.share * 100, entry.hits > 0 ? 1 : 0)}%`,
                        // The same token family the Pascal bubble accents use,
                        // so the bars read in every bundled theme.
                        backgroundColor: `var(--qt-alert-${stateToken(outcome?.state)}-border)`,
                      }}
                    />
                  </div>
                  {entry.hits === 0 && !outcome?.catchAll && (
                    <p className="text-xs qt-text-secondary">
                      This outcome never fired in {audit.runs.toLocaleString()} draws <em>with these parameters and
                      this fact sheet</em> — it may be unreachable, reachable only with other parameter values, or
                      gated on metadata this sheet doesn&rsquo;t carry.
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Card 4 — JSON preview */}
      <section className="qt-card p-3 space-y-2">
        <h3 className="qt-card-title text-sm">The exact bytes</h3>
        <p className="qt-hint">What Save would write — the form&rsquo;s teaching surface.</p>
        <pre className="text-xs font-mono qt-bg-muted rounded p-2 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre">
          {jsonPreview}
        </pre>
      </section>
    </div>
  )
}

function formatShort(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return String(Number(value.toPrecision(4)))
}

/** Map an outcome state to its `--qt-alert-*` token family. */
function stateToken(state: string | undefined): 'success' | 'warning' | 'error' | 'info' {
  switch (state) {
    case 'success':
      return 'success'
    case 'partial':
      return 'warning'
    case 'failure':
      return 'error'
    default:
      return 'info'
  }
}

/**
 * A faithful miniature of the Salon's Pascal bubble — state accent, rendered
 * message, dice breakdown, whisper styling — plus the debug line the real
 * bubble never shows: raw draw, final value, the matched row, and the metadata
 * the winning row consulted.
 */
function MiniPascalBubble({
  roll,
  draft,
  faded,
}: Readonly<{ roll: CustomToolRunResult; draft: ToolDraft; faded: boolean }>) {
  const outcome = draft.outcomes[roll.outcomeIndex]
  const rowLabel = outcome?.catchAll ? 'the catch-all' : `row ${roll.outcomeIndex + 1}`
  const title = displayTitle({ name: draft.name || 'contrivance', title: draft.title || undefined })

  return (
    <div
      className={`qt-pascal-result qt-pascal-result--${roll.state} text-sm py-1 ${faded ? 'opacity-60' : ''} ${
        roll.visibility === 'whisper' ? 'qt-chat-message-whisper' : ''
      }`}
    >
      <p>
        🎲 <strong>{title}</strong> — {roll.message}
      </p>
      {roll.diceBreakdown && <p className="text-xs qt-text-secondary font-mono">{roll.diceBreakdown}</p>}
      {roll.visibility === 'whisper' && <p className="text-xs qt-text-secondary italic">whispered</p>}
      <p className="text-xs qt-text-secondary font-mono">
        raw {formatShort(roll.raw)} → value {formatShort(roll.value)} · matched {rowLabel} ({roll.state})
        {roll.metadataTested &&
          ` · sheet: ${Object.entries(roll.metadataTested)
            .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
            .join(', ')}`}
      </p>
    </div>
  )
}

export default ProvingBench
