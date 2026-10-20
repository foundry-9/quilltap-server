'use client'

/**
 * ProvingBench — the Workbench's right-hand panel: single dry-run rolls, the
 * fact sheet, the Monte Carlo table audit, and the live JSON preview.
 *
 * Rolls and audits execute SERVER-SIDE through the same `executeCustomTool`
 * core a live chat uses (the preview/audit actions on `/api/v1/custom-tools`),
 * so the bench can never drift from what the table would actually deal. The
 * bench posts nothing and writes nothing.
 *
 * The fact sheet's *Pick a character* mode reads and writes the editor's
 * shared wardrobe vantage: a character chosen here is the one the side-effects
 * card browses, and a character vantage chosen there seats them here.
 *
 * The *Mock inventory* card is a list of `{ ref, state, count?, metadata? }`
 * rows the roll, the audit and the gate verdict read as the rolling
 * character's bag (`mockInventoryContext`), so `inventory` /
 * `inventoryCount` / `inventoryAggregate` tests can be proved without a
 * character. The bench cannot tell whether an object exists:
 * `{{inventory.*}}` fields render as written and `$inventory` falls back. No
 * rows means no bag at all — every inventory test declines.
 */

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Icon } from '@/components/ui/icon'
import { apiFetch, apiErrorMessage } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import {
  displayTitle,
  isInventoryRef,
  isStateRef,
  scanPlaceholders,
  type CustomToolParameter,
} from '@/lib/pascal/custom-tool.types'
import type {
  CustomToolAuditResult,
  CustomToolRunResult,
  ResolvedInventoryGesture,
  ResolvedWardrobeGesture,
} from '@/lib/pascal/custom-tools'
import { mockInventoryContext, type MockInventoryRow } from '@/lib/pascal/bench-inventory'
import { INVENTORY_STATE_VALUES } from '@/lib/pascal/inventory-subjects'
import type { InventoryState } from '@/lib/inventory/refs'
import { formatValue } from '@/lib/pascal/expressions'
import { evaluateToolGate, type ToolGateVerdict } from '@/lib/pascal/tool-gate'
import { flattenProgressions } from '@/lib/progressions/engine'
import {
  definitionFromDraft,
  gateFromConditions,
  reachableOutcomesMissingBrief,
  type ToolDraft,
  type WardrobeVantage,
} from '@/lib/pascal/tool-draft'
import type { PreviewWardrobeResolution } from '@/lib/pascal/workbench'
import { formatSlotLabels } from '@/lib/schemas/wardrobe.types'
import { wardrobeOriginLabel } from '@/lib/wardrobe/wardrobe-container'
import { WardrobeItemThumbnail } from '@/components/wardrobe/wardrobe-item-thumbnail'
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
  /** The editor's shared wardrobe vantage; the bench holds its own when absent. */
  vantage?: WardrobeVantage
  onVantageChange?: (next: WardrobeVantage) => void
}

/** A character eligible to lend the bench its fact sheet. */
interface BenchCharacter {
  id: string
  name: string
}

/**
 * The fact sheet, in one of its two modes (§4.5 card 2). The character mode's
 * character is the shared wardrobe vantage's, not the sheet's own.
 */
type FactSheet = { mode: 'character' } | { mode: 'manual'; text: string }

/**
 * The bench's oracle: script an answer, script a silence, or — for single
 * rolls only — spend a real consult. The audit never goes live: ten thousand
 * hands must not mean ten thousand LLM calls.
 */
type BenchOracle = { mode: 'scripted'; answer: string } | { mode: 'fail' } | { mode: 'live' }

/**
 * One mock-inventory row as the bench edits it; `count` is loose text ('' =
 * the default) and `metadata` is JSON object text ('' = `{}`).
 */
interface MockInventoryDraftRow {
  id: number
  ref: string
  state: InventoryState
  count: string
  metadata: string
}

/**
 * A row's metadata, parsed — or why it cannot be. Values must be numbers,
 * strings, booleans, or lists of them, as the mock schema demands.
 */
function parseMockMetadata(text: string): { ok: true; metadata?: MockInventoryRow['metadata'] } | { ok: false; reason: string } {
  if (text.trim() === '') return { ok: true }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'is not valid JSON' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'must be a JSON object' }
  }
  const scalar = (v: unknown) =>
    typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))
  for (const [key, value] of Object.entries(parsed)) {
    if (!scalar(value) && !(Array.isArray(value) && value.every(scalar))) {
      return { ok: false, reason: `"${key}" must be a number, text, true/false, or a list of them` }
    }
  }
  return { ok: true, metadata: parsed as MockInventoryRow['metadata'] }
}

/** The rows a request sends: blank refs dropped, counts and metadata parsed. Empty = no bag at all. */
function mockRowsOf(rows: readonly MockInventoryDraftRow[]): MockInventoryRow[] {
  return rows
    .filter((row) => row.ref.trim() !== '')
    .map((row) => {
      const count = Number(row.count)
      const metadata = parseMockMetadata(row.metadata)
      return {
        ref: row.ref.trim(),
        state: row.state,
        ...(row.count.trim() !== '' && Number.isInteger(count) && count >= 0 ? { count } : {}),
        ...(metadata.ok && metadata.metadata ? { metadata: metadata.metadata } : {}),
      }
    })
}

/**
 * A bench roll, plus the gate verdict the server computed alongside it. The
 * bench always deals — a gate decides whether a character is OFFERED a tool,
 * not whether its author may test one they are holding — so the verdict rides
 * beside the roll rather than replacing it.
 */
type BenchRoll = CustomToolRunResult & {
  gate?: ToolGateVerdict
  /** With a character in the chair: what each wardrobe gesture would have found. */
  wardrobeResolution?: PreviewWardrobeResolution[]
  /** The chair's name when the roll was dealt, for "not in Imogen's reach". */
  chairName?: string | null
}

/** {@link apiErrorMessage} with the bench's own fallback. */
function extractErrorMessage(err: unknown): string {
  return apiErrorMessage(err, 'The bench could not oblige.')
}

export function ProvingBench({ draft, valid, onMatched, vantage: sharedVantage, onVantageChange }: Readonly<ProvingBenchProps>) {
  const [localVantage, setLocalVantage] = useState<WardrobeVantage>({ kind: 'none' })
  const vantage = sharedVantage ?? localVantage
  const setVantage = onVantageChange ?? setLocalVantage
  const chairCharacterId = vantage.kind === 'character' ? vantage.characterId : ''

  /** The document Save would write — what every roll, audit, and the preview send. */
  const definition = useMemo(() => definitionFromDraft(draft), [draft])

  /**
   * The bench's parameter form, read off the serialized definition so it can
   * never disagree with what the roll is sent. A `$state` default is dropped:
   * the form cannot type one, and the server resolves it against mock state.
   */
  const paramSpecs = useMemo(() => {
    const specs: Record<string, CustomToolParameterSpec> = {}
    const declared = (definition.parameters ?? {}) as Record<string, CustomToolParameter>
    for (const [name, spec] of Object.entries(declared)) {
      if (isStateRef(spec.default) || isInventoryRef(spec.default)) continue
      // A half-typed numeric default serializes as NaN (the form is already
      // flagging it); the bench field shows 0 rather than "NaN".
      const fallback = typeof spec.default === 'number' && !Number.isFinite(spec.default) ? 0 : spec.default
      specs[name] = { ...spec, default: fallback }
    }
    return specs
  }, [definition])

  const [values, setValues] = useState<ParameterFormValues>({})
  const [isPrivate, setIsPrivate] = useState(false)
  const [sheet, setSheet] = useState<FactSheet>(() =>
    chairCharacterId ? { mode: 'character' } : { mode: 'manual', text: '{}' }
  )
  // A character vantage chosen elsewhere (the side-effects card, or the
  // editor's opening default) seats that character here. Derived during
  // render, latched on the character id.
  const [seatedCharacterId, setSeatedCharacterId] = useState(chairCharacterId)
  if (chairCharacterId !== seatedCharacterId) {
    setSeatedCharacterId(chairCharacterId)
    if (chairCharacterId && sheet.mode !== 'character') setSheet({ mode: 'character' })
  }
  const [mockStateText, setMockStateText] = useState('{}')
  const [mockInventory, setMockInventory] = useState<MockInventoryDraftRow[]>([])
  const mockRows = useMemo(() => mockRowsOf(mockInventory), [mockInventory])
  /** The first mock row whose metadata will not parse — the bench refuses to run until it does. */
  const mockInventoryError = useMemo(() => {
    for (const row of mockInventory) {
      const parsed = parseMockMetadata(row.metadata)
      if (!parsed.ok) return `${row.ref.trim() || 'A mock object'}: metadata ${parsed.reason}`
    }
    return null
  }, [mockInventory])
  const benchInventory = mockRows.length > 0 ? mockRows : undefined
  const [oracle, setOracle] = useState<BenchOracle>({ mode: 'scripted', answer: '' })
  const [rolls, setRolls] = useState<BenchRoll[]>([])
  const [audit, setAudit] = useState<CustomToolAuditResult | null>(null)

  // Merge declared defaults under whatever the user has touched, so a fresh
  // parameter shows up pre-filled without wiping edits to the others.
  const effectiveValues = useMemo(
    () => ({ ...initialParamValues(paramSpecs), ...values }),
    [paramSpecs, values]
  )

  const testsMetadata = draft.outcomes.some((o) => o.conditions.some((c) => c.subject.kind === 'metadata'))
  const testsInventory =
    draft.outcomes.some((o) =>
      o.conditions.some(
        (c) =>
          c.subject.kind === 'inventory' || c.subject.kind === 'inventoryCount' || c.subject.kind === 'inventoryAggregate'
      )
    ) ||
    draft.gateConditions.some(
      (c) => c.subject === 'inventory' || c.subject === 'inventoryCount' || c.subject === 'inventoryAggregate'
    )

  /**
   * The clock the derived-progressions panel reads.
   *
   * Held in state and advanced by an interval rather than read during render:
   * `Date.now()` in a render body is impure, and React is entitled to re-run a
   * render whenever it likes. The interval runs only while a hand-typed sheet
   * is in play, so a bench with no progressions on it costs nothing.
   */
  const [benchNowMs, setBenchNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (sheet.mode !== 'manual') return
    // The interval alone, with no priming call: the first tick lands within a
    // second, and setting state straight from an effect body is the render
    // loop nobody wants.
    const timer = setInterval(() => setBenchNowMs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [sheet.mode])

  /**
   * The progress sheet a hand-typed fact sheet derives to, at THIS instant.
   *
   * Shown read-only under the sheet so the author can see `cannon.percent`
   * before rolling, rather than working it out from two ISO timestamps in
   * their head. A character-backed sheet lives on the server, so the bench
   * declines to guess at it — the same line the gate verdict already draws.
   *
   * Derived on every render on purpose: it is a live clock, and a stale
   * "42% complete" beside an advancing recharge would be a worse lie than no
   * panel at all.
   */
  const derivedProgress = useMemo(() => {
    if (sheet.mode !== 'manual') return null
    try {
      const parsed: unknown = JSON.parse(sheet.text)
      const flattened = flattenProgressions(parsed, benchNowMs)
      return Object.keys(flattened).length > 0 ? flattened : null
    } catch {
      return null
    }
  }, [sheet, benchNowMs])

  /**
   * The draft's availability gate, in the shape {@link evaluateToolGate} takes.
   * Null while the tool is ungated or the gate is still half-typed — the form
   * is already complaining about the latter, and the bench need not join in.
   */
  const draftGate = useMemo(() => {
    if (draft.gateMode === 'none') return null
    const gate = gateFromConditions(draft.gateConditions)
    if (!gate) return null
    return draft.gateMode === 'available' ? { availableWhen: gate } : { withheldWhen: gate }
  }, [draft.gateMode, draft.gateConditions])

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
    if (sheet.mode === 'character') return chairCharacterId ? { characterId: chairCharacterId } : undefined
    try {
      const parsed = JSON.parse(sheet.text)
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined
    } catch {
      return undefined
    }
  }

  const testsState =
    draft.outcomes.some((o) => o.conditions.some((c) => c.operand.kind === 'state')) ||
    (draft.rollForm === 'range' &&
      (['min', 'max', 'multiplier', 'offset'] as const).some((f) => draft.rollRange[f].kind === 'state')) ||
    draft.parameters.some((p) => isStateRef(p.defaultValue)) ||
    draft.outcomes.some((o) => scanPlaceholders(o.message).some((p) => p.ref.kind === 'state'))

  const mockStateError = useMemo(() => {
    try {
      const parsed = JSON.parse(mockStateText)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return 'Mock state must be a single JSON object.'
      }
      return null
    } catch {
      return 'Mock state is not valid JSON.'
    }
  }, [mockStateText])

  /** The mock merged state a bench roll or audit resolves `$state` against. */
  const benchState = (): Record<string, unknown> | undefined => {
    try {
      const parsed = JSON.parse(mockStateText)
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined
    } catch {
      return undefined
    }
  }

  /** The oracle input for a single roll; undefined when the tool has no consult. */
  const previewOracle = (): { output: string } | { fail: true } | { live: true } | undefined => {
    if (!draft.llmEnabled) return undefined
    if (oracle.mode === 'live') return { live: true }
    if (oracle.mode === 'scripted' && oracle.answer.trim() !== '') return { output: oracle.answer }
    return { fail: true }
  }

  /** The audit's oracle: the scripted answer, else silence. Never live. */
  const auditOracle = (): { output: string } | { fail: true } | undefined => {
    if (!draft.llmEnabled) return undefined
    if (oracle.mode === 'scripted' && oracle.answer.trim() !== '') return { output: oracle.answer }
    return { fail: true }
  }

  const rollMutation = useMutation({
    mutationFn: () =>
      apiFetch<BenchRoll>('/api/v1/custom-tools?action=preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          definition,
          params: coerceParamValues(paramSpecs, effectiveValues),
          private: isPrivate,
          metadata: benchMetadata(),
          state: benchState(),
          inventory: benchInventory,
          llm: previewOracle(),
        }),
      }),
    onSuccess: (result) => {
      const chairName =
        sheet.mode === 'character'
          ? (charactersQuery.data ?? []).find((c) => c.id === chairCharacterId)?.name ?? null
          : null
      setRolls((prev) => [{ ...result, chairName }, ...prev].slice(0, 10))
      onMatched?.(draft.outcomes[result.outcomeIndex]?.id ?? null)
    },
  })

  const auditMutation = useMutation({
    mutationFn: () =>
      apiFetch<CustomToolAuditResult>('/api/v1/custom-tools?action=audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          definition,
          params: coerceParamValues(paramSpecs, effectiveValues),
          metadata: benchMetadata(),
          state: benchState(),
          inventory: benchInventory,
          llm: auditOracle(),
        }),
      }),
    onSuccess: setAudit,
  })

  const benchDisabled =
    !valid ||
    (sheet.mode === 'manual' && manualSheetError !== null) ||
    mockStateError !== null ||
    mockInventoryError !== null
  const jsonPreview = useMemo(() => `${JSON.stringify(definition, null, 2)}\n`, [definition])

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
          Metadata tests read the invoking character&rsquo;s <code>metadata.json</code>, and{' '}
          <code>progress</code> tests read the <code>progressions</code> key inside it. Lend the bench a sheet, or
          it rolls as nobody in particular.
        </p>
        <div className="flex rounded overflow-hidden border w-fit" role="radiogroup" aria-label="Fact sheet mode">
          <button
            type="button"
            role="radio"
            aria-checked={sheet.mode === 'character'}
            className={`px-2 py-1 text-xs ${sheet.mode === 'character' ? 'qt-button qt-button-primary' : 'qt-button qt-button-ghost'}`}
            onClick={() => setSheet({ mode: 'character' })}
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
            value={chairCharacterId}
            onChange={(e) => {
              const characterId = e.target.value
              if (characterId) setVantage({ kind: 'character', characterId })
              else if (vantage.kind === 'character') setVantage({ kind: 'none' })
            }}
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
            (sheet.mode === 'character' && !chairCharacterId)) && (
            <p className="text-xs qt-text-secondary">
              No fact sheet supplied — metadata tests will all decline, exactly as for an unattributed manual roll.
            </p>
          )}

        {derivedProgress && (
          <div className="space-y-1">
            <p className="text-xs qt-text-secondary">
              Progressions derived from this sheet, as of now — what a <code>progress</code> test or{' '}
              <code>{'{{progress.…}}'}</code> would read this second:
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-xs">
              {Object.entries(derivedProgress).map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="qt-text-secondary">{key}</dt>
                  <dd className="qt-text truncate">{String(value)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {draftGate && (
          <GateVerdictLine
            /* A hand-typed sheet is right here, so the verdict is live. A
               character's real sheet lives on the server, so that one comes
               back with a roll — the bench never guesses at a vault. */
            verdict={
              sheet.mode === 'manual' && manualSheetError === null
                ? evaluateToolGate(
                    draftGate,
                    benchMetadata() as Record<string, unknown>,
                    derivedProgress,
                    mockRows.length > 0 ? mockInventoryContext(mockRows) : null
                  )
                : (rolls[0]?.gate ?? null)
            }
          />
        )}
      </section>

      {/* Card 2¾ — Mock state, for $state references */}
      <section className="qt-card p-3 space-y-2">
        <h3 className="qt-card-title text-sm">Mock state</h3>
        <p className="qt-hint">
          The merged state (chat → project → group → general) a roll resolves <code>$state</code> references
          against. A path that is absent or the wrong type falls back to the reference&rsquo;s own fallback.
        </p>
        <textarea
          value={mockStateText}
          onChange={(e) => setMockStateText(e.target.value)}
          rows={3}
          className={`qt-textarea w-full font-mono text-xs ${mockStateError ? 'qt-input-error' : ''}`}
          aria-label="Mock merged state (JSON object)"
          spellCheck={false}
        />
        {mockStateError && <p className="text-xs qt-text-destructive">{mockStateError}</p>}
        {testsState && mockStateText.trim().replace(/\s/g, '') === '{}' && (
          <p className="text-xs qt-text-secondary">
            No mock state supplied — every <code>$state</code> reference will use its fallback.
          </p>
        )}
      </section>

      {/* Card 2⅞ — Mock inventory, for inventory / inventoryCount / inventoryAggregate tests */}
      <section className="qt-card p-3 space-y-2">
        <h3 className="qt-card-title text-sm">Mock inventory</h3>
        <p className="qt-hint">
          What the rolling character carries, as the bench pretends it: a reference, its state, and — optionally —
          how many of its kind are equipped and a <code>metadata</code> object for aggregate tests. A reference no
          row names reads as absent. The bench cannot tell whether an object exists, so its fields render as
          written and <code>$inventory</code> falls back.
        </p>
        {mockInventory.map((row) => (
          <div key={row.id} className="space-y-1">
            <div className="flex items-center gap-1 flex-wrap">
              <input
                type="text"
                value={row.ref}
                onChange={(e) =>
                  setMockInventory((prev) => prev.map((r) => (r.id === row.id ? { ...r, ref: e.target.value } : r)))
                }
                placeholder="Excalibur"
                className="qt-input flex-1 min-w-24 text-xs"
                aria-label="Mock object reference"
              />
              <select
                value={row.state}
                onChange={(e) =>
                  setMockInventory((prev) =>
                    prev.map((r) => (r.id === row.id ? { ...r, state: e.target.value as InventoryState } : r))
                  )
                }
                className="qt-select qt-select-sm w-28"
                aria-label="Mock object state"
              >
                {INVENTORY_STATE_VALUES.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={0}
                step={1}
                value={row.count}
                onChange={(e) =>
                  setMockInventory((prev) => prev.map((r) => (r.id === row.id ? { ...r, count: e.target.value } : r)))
                }
                placeholder={row.state === 'equipped' ? '1' : '0'}
                className="qt-input w-16 text-xs"
                aria-label="Mock equipped count"
                title="How many of its kind are equipped (default: 1 when equipped, else 0)"
              />
              <button
                type="button"
                className="qt-button qt-button-ghost qt-button-sm"
                onClick={() => setMockInventory((prev) => prev.filter((r) => r.id !== row.id))}
                aria-label="Remove this mock object"
              >
                <Icon name="close" className="w-3 h-3" />
              </button>
            </div>
            <input
              type="text"
              value={row.metadata}
              onChange={(e) =>
                setMockInventory((prev) => prev.map((r) => (r.id === row.id ? { ...r, metadata: e.target.value } : r)))
              }
              placeholder='metadata, e.g. {"toolVersion": 3, "toolAbilities": ["suppress"]}'
              className={`qt-input w-full font-mono text-xs ${parseMockMetadata(row.metadata).ok ? '' : 'qt-input-error'}`}
              aria-label="Mock object metadata (JSON object)"
              title="What inventoryAggregate reads off this object. Blank is {}. An equipped row with a count stands for that many copies."
              spellCheck={false}
            />
          </div>
        ))}
        {mockInventoryError && <p className="text-xs qt-text-destructive">{mockInventoryError}</p>}
        <button
          type="button"
          className="qt-button qt-button-ghost qt-button-sm"
          onClick={() =>
            setMockInventory((prev) => [
              ...prev,
              { id: (prev[prev.length - 1]?.id ?? 0) + 1, ref: '', state: 'equipped', count: '', metadata: '' },
            ])
          }
        >
          <Icon name="plus" className="w-3 h-3" />
          add object
        </button>
        {testsInventory && mockRows.length === 0 && (
          <p className="text-xs qt-text-secondary">
            No mock inventory — every inventory test declines, exactly as for a run nobody made.
          </p>
        )}
      </section>

      {/* Card 2½ — The oracle (only when the tool consults one) */}
      {draft.llmEnabled && (
        <section className="qt-card p-3 space-y-2">
          <h3 className="qt-card-title text-sm">The oracle</h3>
          <p className="qt-hint">
            This tool consults a model mid-run. Script its answer here, or spend a real consult on a single roll.
          </p>
          <div className="flex rounded overflow-hidden border w-fit" role="radiogroup" aria-label="Oracle mode">
            <button
              type="button"
              role="radio"
              aria-checked={oracle.mode === 'scripted'}
              className={`px-2 py-1 text-xs ${oracle.mode === 'scripted' ? 'qt-button qt-button-primary' : 'qt-button qt-button-ghost'}`}
              onClick={() => setOracle({ mode: 'scripted', answer: oracle.mode === 'scripted' ? oracle.answer : '' })}
            >
              Scripted answer
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={oracle.mode === 'fail'}
              className={`px-2 py-1 text-xs ${oracle.mode === 'fail' ? 'qt-button qt-button-primary' : 'qt-button qt-button-ghost'}`}
              onClick={() => setOracle({ mode: 'fail' })}
              title="The consult fails; the run shows your error line"
            >
              Silence
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={oracle.mode === 'live'}
              className={`px-2 py-1 text-xs ${oracle.mode === 'live' ? 'qt-button qt-button-primary' : 'qt-button qt-button-ghost'}`}
              onClick={() => setOracle({ mode: 'live' })}
              title="A single roll asks the real model — one paid consult per roll"
            >
              Ask it live
            </button>
          </div>

          {oracle.mode === 'scripted' && (
            <div>
              <textarea
                value={oracle.answer}
                onChange={(e) => setOracle({ mode: 'scripted', answer: e.target.value })}
                rows={2}
                className="qt-textarea w-full text-xs"
                placeholder="What shall the oracle be made to say?"
                aria-label="Scripted oracle answer"
              />
              {oracle.answer.trim() === '' && (
                <p className="text-xs qt-text-secondary">
                  Empty — the bench treats this as silence, and the run shows your error line.
                </p>
              )}
            </div>
          )}
          {oracle.mode === 'live' && (
            <p className="text-xs qt-text-secondary">
              Each roll pays for one real consult through the cheap-model machinery. The audit never goes live — it
              deals its hands against the scripted answer, or silence.
            </p>
          )}
        </section>
      )}

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
              {audit.runs.toLocaleString()} draws · values {formatValue(audit.valueMin)}–{formatValue(audit.valueMax)} ·
              mean {formatValue(audit.valueMean)}
            </p>
            {audit.outcomes.map((entry) => {
              const missingBrief = reachableOutcomesMissingBrief(draft, audit.outcomes)
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
                  <div className="qt-progress qt-progress-sm">
                    <div
                      className="qt-progress-fill"
                      style={{
                        width: `${Math.max(entry.share * 100, entry.hits > 0 ? 1 : 0)}%`,
                        // Per-outcome colour goes through the bar family's own
                        // indicator variable rather than a bespoke background,
                        // so a theme restyling `qt-progress` restyles these too.
                        // The value is the same token family the Pascal bubble
                        // accents use, so the bars read in every bundled theme.
                        ['--qt-progress-indicator' as string]: `var(--qt-alert-${stateToken(outcome?.state)}-border)`,
                      } as React.CSSProperties}
                    />
                  </div>
                  {missingBrief.includes(entry.index) && (
                    <p className="text-xs qt-text-destructive">
                      This outcome can win, and the consult prompt reads {'{{outcome.brief}}'}, but the row has no
                      brief — the model would be shown the placeholder as written. Give it a brief.
                    </p>
                  )}
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

/**
 * Whether this sheet would be dealt the tool at all — the one thing a roll can
 * never show, since the bench deals to whoever asks.
 */
function GateVerdictLine({ verdict }: Readonly<{ verdict: ToolGateVerdict | null }>) {
  if (!verdict) {
    return (
      <p className="text-xs qt-text-secondary">
        This tool is gated. Roll once to learn whether this character would be offered it.
      </p>
    )
  }

  // An any-of names the line that decided it; a single group has only the one.
  const line = verdict.heldGroup !== undefined ? verdict.heldGroup + 1 : null

  if (verdict.available) {
    return (
      <p className="text-xs qt-text-secondary">
        ✓ This sheet would be offered the tool{line !== null ? ` — passed on line ${line}` : ''}.
      </p>
    )
  }

  return (
    <p className="text-xs qt-text-destructive">
      ✕ This sheet would never be offered the tool —{' '}
      {verdict.withheldBy === 'availableWhen'
        ? 'it passes no line of the “only show if” tests.'
        : line !== null
          ? `it passes line ${line} of the “do not show if” tests.`
          : 'it passes the “do not show if” test.'}{' '}
      The roll below is the bench indulging you.
    </p>
  )
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
 * A faithful miniature of the Salon's Pascal bubble — state accent, the
 * heading paragraph over its own message block (the chip label as heading when
 * the run rendered one), dice breakdown, whisper styling — plus the debug
 * lines the real bubble never shows: raw draw, final value, the matched row,
 * the metadata the winning row consulted, and the effects as a dry run. The
 * bench computes those effects; it never applies them.
 */
function MiniPascalBubble({
  roll,
  draft,
  faded,
}: Readonly<{ roll: BenchRoll; draft: ToolDraft; faded: boolean }>) {
  const outcome = draft.outcomes[roll.outcomeIndex]
  const rowLabel = outcome?.catchAll ? 'the catch-all' : `row ${roll.outcomeIndex + 1}`
  const title = displayTitle({ name: draft.name || 'contrivance', title: draft.title || undefined })
  const heading = roll.chipLabel?.trim() || title

  return (
    <div
      className={`qt-pascal-result qt-pascal-result--${roll.state} text-sm py-1 ${faded ? 'opacity-60' : ''} ${
        roll.visibility === 'whisper' ? 'qt-chat-message-whisper' : ''
      }`}
    >
      <p>
        🎲 <strong>{heading}</strong>
      </p>
      <p>{roll.message}</p>
      {roll.diceBreakdown && <p className="text-xs qt-text-secondary font-mono">{roll.diceBreakdown}</p>}
      {roll.visibility === 'whisper' && <p className="text-xs qt-text-secondary italic">whispered</p>}
      <p className="text-xs qt-text-secondary font-mono">
        raw {formatValue(roll.raw)} → value {formatValue(roll.value)} · matched {rowLabel} ({roll.state})
        {roll.metadataTested &&
          ` · sheet: ${Object.entries(roll.metadataTested)
            .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
            .join(', ')}`}
      </p>
      {roll.llm && (
        <p className="text-xs qt-text-secondary font-mono">
          consult {roll.llm.ok ? 'answered' : `failed (${roll.llm.reason ?? 'no reason recorded'})`}:{' '}
          {JSON.stringify(roll.llm.output)}
        </p>
      )}
      {roll.effects && roll.effects.length > 0 && (
        <div className="text-xs qt-text-secondary font-mono">
          {roll.effects.map((effect) =>
            'target' in effect ? (
              <p key={effect.index}>
                → {effect.target.raw} = {JSON.stringify(effect.value)} <em>(would write)</em>
              </p>
            ) : 'inventory' in effect ? (
              <p key={effect.index}>
                → inventory: {describeBenchInventoryGesture(effect.inventory)} <em>(would attempt)</em>
              </p>
            ) : 'wardrobe' in effect ? (
              <BenchWardrobeLines
                key={effect.index}
                gesture={effect.wardrobe}
                resolution={roll.wardrobeResolution?.find((entry) => entry.index === effect.index)}
                chairName={roll.chairName ?? null}
              />
            ) : 'log' in effect ? (
              <p key={effect.index}>
                → log: {JSON.stringify(effect.log)} <em>(would write)</em>
              </p>
            ) : (
              <p key={effect.index}>
                · effect {effect.index + 1} skipped: {effect.skipped}
              </p>
            )
          )}
          <p className="italic">The bench computes effects; it never applies them.</p>
        </div>
      )}
    </div>
  )
}

/** An inventory gesture in the bench's words: `equip "Excalibur"`, `pick up "magic bow" (unequipped)`. */
function describeBenchInventoryGesture(gesture: ResolvedInventoryGesture): string {
  const items = gesture.items.map((item) => `“${item}”`).join(', ')
  const verb = gesture.action === 'pick_up' ? 'pick up' : gesture.action
  return `${verb} ${items}${gesture.action === 'pick_up' && gesture.equip === false ? ' (unequipped)' : ''}`
}

/** The gesture's verb and mode, in the bench's words: "wear (add to slot top)", "take off … from top". */
function gestureVerb(gesture: ResolvedWardrobeGesture): { verb: string; suffix: string } {
  switch (gesture.action) {
    case 'wear':
      return {
        verb: 'wear',
        suffix:
          gesture.mode && gesture.mode !== 'wear'
            ? ` (${gesture.mode.replace(/_/g, ' ')}${gesture.slot ? ` ${gesture.slot}` : ''})`
            : '',
      }
    case 'take_off':
      return { verb: 'take off', suffix: gesture.slot ? ` from ${gesture.slot}` : '' }
    case 'clear_slot':
      return { verb: 'clear', suffix: '' }
  }
}

/**
 * A dry-run gesture, in the bench's words. "Would attempt" when nobody sits in
 * the chair — the bench cannot know a garment exists without a wardrobe to
 * look in. With a character in the chair the server resolves each reference
 * through the applier's own lookup, so each item says what it would have
 * found ("would apply") or why it would be skipped ("would skip").
 */
function describeBenchGesture(gesture: ResolvedWardrobeGesture): string {
  const items = gesture.items.map((item) => `“${item}”`).join(', ')
  const { verb, suffix } = gestureVerb(gesture)
  if (gesture.action === 'clear_slot') return `clear ${gesture.slot ?? 'a slot'}`
  return `${verb} ${items}${suffix}`
}

function BenchWardrobeLines({
  gesture,
  resolution,
  chairName,
}: Readonly<{ gesture: ResolvedWardrobeGesture; resolution: PreviewWardrobeResolution | undefined; chairName: string | null }>) {
  if (!resolution || gesture.action === 'clear_slot') {
    return (
      <p>
        → wardrobe: {describeBenchGesture(gesture)} <em>(would attempt)</em>
      </p>
    )
  }
  const { verb, suffix } = gestureVerb(gesture)
  return (
    <>
      {resolution.items.map((entry, i) => {
        if (entry.found) {
          const origin = wardrobeOriginLabel(entry.found.origin)
          const slots = formatSlotLabels(entry.found.types)
          const detail = [slots, origin].filter(Boolean).join(' · ')
          return (
            <p key={`${entry.ref}-${i}`}>
              → wardrobe: {verb}{' '}
              <WardrobeItemThumbnail
                fileId={entry.found.imageFileId}
                size={28}
                className="inline-block align-middle mr-1"
              />
              {entry.found.title}
              {detail ? ` (${detail})` : ''}
              {suffix} <em>(would apply)</em>
            </p>
          )
        }
        const why =
          entry.reason === 'not_found' ? `not in ${chairName ? `${chairName}’s` : 'the chair’s'} reach` : entry.message
        return (
          <p key={`${entry.ref}-${i}`}>
            → wardrobe: {verb} “{entry.ref}”{suffix} — {why} <em>(would skip)</em>
          </p>
        )
      })}
    </>
  )
}

export default ProvingBench
