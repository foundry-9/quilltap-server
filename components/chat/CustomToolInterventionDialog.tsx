'use client'

/**
 * CustomToolInterventionDialog — Pascal holds a roll for the operator.
 *
 * When a model's `run_custom` or a trigger phrase reaches a custom tool marked
 * intervenable, the server deals the run and then HOLDS it inside the turn
 * until the operator answers here: deal it (perhaps changed), let it stand as
 * rolled, or set the table aside (a veto). The model is never told.
 *
 * The hold lives on the server, not in the stream, so this dialog reads the
 * chat's pending holds through TanStack Query, refreshed by the
 * `customToolInterventions` realtime topic (lib/realtime/topic-map.ts) with a
 * poll only as the offline fallback. A reload or a second tab therefore
 * reopens it. Several holds are shown one at a time, oldest first.
 *
 * The client never computes a run itself: every edit is a set of PINS
 * (`InterventionOverrides`) sent to `?action=intervention-preview`, debounced,
 * and the server's recompute is what is shown — and what is finally dealt.
 * Fields the author hid are not rendered at all (the server would refuse them).
 *
 * Design of record: docs/developer/features/complete/pascal-operator-intervention.md.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BaseModal } from '@/components/ui/BaseModal'
import { apiFetch, apiErrorMessage } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useRealtimeRefetchInterval } from '@/hooks/useRealtime'
import { showErrorToast } from '@/lib/toast'
import { COMPARATOR_LABELS } from '@/components/custom-tools/comparator-labels'
import {
  CustomToolParamsForm,
  coerceParamValues,
  type CustomToolParameterSpec,
  type ParameterFormValues,
} from '@/components/custom-tools/CustomToolParamsForm'
import type { OutcomeState, When, WhenObject } from '@/lib/pascal/custom-tool.types'
import type { InterventionOverrides } from '@/lib/pascal/intervention/overrides'
import type {
  InterventionEffectView,
  InterventionHoldView,
  InterventionPreview,
  InterventionRunView,
} from '@/lib/pascal/intervention/view'

const PREVIEW_DEBOUNCE_MS = 300
const OUTCOME_STATES: OutcomeState[] = ['success', 'partial', 'failure', 'info']

type EffectPin = NonNullable<InterventionOverrides['effects']>[string]

interface Props {
  chatId: string
}

/** Format a number the way Pascal does: integers plain, floats to 4 significant digits. */
function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(4)))
}

/** A row's `when`, summarised for the outcome list. */
function summarizeWhen(when: When): string {
  if (when === true) return 'otherwise'
  const groups = Array.isArray(when) ? when : [when]
  return groups.map(summarizeGroup).join(' or ')
}

function summarizeGroup(group: WhenObject): string {
  const parts: string[] = []
  const comparators = (subject: string, comparator: Record<string, unknown> | undefined) => {
    if (!comparator) return
    for (const [key, label] of Object.entries(COMPARATOR_LABELS)) {
      const operand = comparator[key]
      if (operand === undefined) continue
      const shown =
        typeof operand === 'object' && operand !== null && '$param' in operand
          ? `params.${(operand as { $param: string }).$param}`
          : typeof operand === 'number'
            ? formatNumber(operand)
            : JSON.stringify(operand)
      parts.push(`${subject} ${label} ${shown}`)
    }
  }
  comparators('value', group as unknown as Record<string, unknown>)
  comparators('roll', group.roll as Record<string, unknown> | undefined)
  for (const [name, comparator] of Object.entries(group.params ?? {})) comparators(`params.${name}`, comparator)
  for (const [key, comparator] of Object.entries(group.metadata ?? {})) comparators(`metadata.${key}`, comparator)
  if (group.llm) {
    if (group.llm.ok !== undefined) parts.push(group.llm.ok ? 'consult answered' : 'consult failed')
    comparators('answer', group.llm as Record<string, unknown>)
  }
  const other = ['state', 'progress', 'inventory', 'inventoryCount', 'inventoryAggregate'].filter(
    (key) => (group as Record<string, unknown>)[key] !== undefined,
  )
  if (other.length > 0) parts.push(`${other.join(', ')} tests`)
  return parts.length > 1 ? `(${parts.join(' and ')})` : (parts[0] ?? 'always')
}

/** An edited effect value is a literal: a boolean, a number, or the text as typed. */
function literalFrom(text: string): number | string | boolean {
  if (text === 'true') return true
  if (text === 'false') return false
  const n = Number(text)
  return text.trim() !== '' && Number.isFinite(n) ? n : text
}

/** Drop a key from the overrides — the reset control. */
function unpin<K extends keyof InterventionOverrides>(overrides: InterventionOverrides, key: K): InterventionOverrides {
  const { [key]: _gone, ...rest } = overrides
  return rest
}

export function CustomToolInterventionDialog({ chatId }: Readonly<Props>) {
  const queryClient = useQueryClient()
  const queryKey = queryKeys.customTools.interventions(chatId)

  const holdsQuery = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      apiFetch<{ holds: InterventionHoldView[] }>(`/api/v1/chats/${chatId}/custom-tools?action=interventions`, {
        signal,
      }),
    refetchInterval: useRealtimeRefetchInterval(5_000),
  })

  const holds = holdsQuery.data?.holds ?? []
  const hold = holds[0] ?? null

  if (!hold) return null
  // Keyed by hold id: a fresh hold starts with a clean slate of pins.
  return (
    <HeldRun
      key={hold.id}
      chatId={chatId}
      hold={hold}
      waiting={holds.length - 1}
      onSettled={() => queryClient.invalidateQueries({ queryKey })}
    />
  )
}

interface HeldRunProps {
  chatId: string
  hold: InterventionHoldView
  /** How many more holds wait behind this one. */
  waiting: number
  onSettled: () => void
}

function HeldRun({ chatId, hold, waiting, onSettled }: Readonly<HeldRunProps>) {
  const [overrides, setOverrides] = useState<InterventionOverrides>({})
  const [serverPreview, setPreview] = useState<InterventionPreview | null>(null)
  const [consults, setConsults] = useState(hold.consults)
  const [confirmingVeto, setConfirmingVeto] = useState(false)
  const shown = useMemo(() => new Set<string>(hold.eligible.fields), [hold.eligible.fields])
  const pinnedCount = Object.keys(overrides).length
  // With nothing pinned the run is simply the run as dealt.
  const preview = pinnedCount === 0 ? hold.baseline : (serverPreview ?? hold.baseline)

  const base = `/api/v1/chats/${chatId}/custom-tools`
  const post = useCallback(
    <T,>(action: string, body: unknown) =>
      apiFetch<T>(`${base}?action=${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    [base],
  )

  const previewMutation = useMutation({
    mutationFn: (next: InterventionOverrides) =>
      post<{ preview: InterventionPreview }>('intervention-preview', { id: hold.id, overrides: next }),
    onSuccess: (data) => setPreview(data.preview),
    onError: (err) => showErrorToast(apiErrorMessage(err, 'Pascal could not reckon that change')),
  })
  const { mutate: runPreview } = previewMutation

  // Every edit asks the server; nothing is computed here.
  useEffect(() => {
    if (Object.keys(overrides).length === 0) return
    const timer = setTimeout(() => runPreview(overrides), PREVIEW_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [overrides, runPreview])

  const reaskMutation = useMutation({
    mutationFn: () =>
      post<{ preview: InterventionPreview; consults: InterventionHoldView['consults'] }>('intervention-reask', {
        id: hold.id,
        overrides,
      }),
    onSuccess: (data) => {
      // Re-ask replaces a pinned answer with a fresh one.
      setOverrides((prev) => unpin(prev, 'llmAnswer'))
      setConsults(data.consults)
      setPreview(data.preview)
    },
    onError: (err) => showErrorToast(apiErrorMessage(err, 'The oracle would not answer again')),
  })

  const resolveMutation = useMutation({
    mutationFn: (decision: { kind: 'deal'; overrides: InterventionOverrides } | { kind: 'as-rolled' } | { kind: 'veto' }) =>
      post('intervention-resolve', { id: hold.id, decision }),
    onSuccess: onSettled,
    onError: (err) => {
      showErrorToast(apiErrorMessage(err, 'Pascal could not settle that roll'))
      onSettled()
    },
  })

  const busy = resolveMutation.isPending
  const run = preview.run
  const dealt = hold.baseline.run
  const pin = (patch: InterventionOverrides) => setOverrides((prev) => ({ ...prev, ...patch }))
  const reset = (key: keyof InterventionOverrides) => setOverrides((prev) => unpin(prev, key))

  const reached =
    hold.entrance === 'trigger'
      ? `overheard: “${hold.triggerPhrase ?? ''}”`
      : hold.characterName
        ? `called by ${hold.characterName}`
        : 'called by a character'

  const footer = (
    <div className="flex flex-wrap items-center justify-end gap-2 w-full">
      {confirmingVeto ? (
        <>
          <span className="text-sm qt-text-secondary mr-auto">Sweep the cards away? Nothing is announced and nothing changes.</span>
          <button type="button" className="qt-button qt-button-secondary" onClick={() => setConfirmingVeto(false)} disabled={busy}>
            Keep the table
          </button>
          <button
            type="button"
            className="qt-button qt-button-destructive"
            onClick={() => resolveMutation.mutate({ kind: 'veto' })}
            disabled={busy}
          >
            Set it aside
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="qt-button qt-button-secondary mr-auto"
            onClick={() => setConfirmingVeto(true)}
            disabled={busy}
          >
            Set the table aside
          </button>
          <button
            type="button"
            className="qt-button qt-button-secondary"
            onClick={() => resolveMutation.mutate({ kind: 'as-rolled' })}
            disabled={busy}
          >
            As rolled
          </button>
          <button
            type="button"
            className="qt-button qt-button-primary"
            onClick={() => resolveMutation.mutate({ kind: 'deal', overrides })}
            disabled={busy || previewMutation.isPending}
          >
            Deal it
          </button>
        </>
      )}
    </div>
  )

  return (
    <BaseModal
      isOpen
      // A held roll waits for an answer; there is no dismissing it unanswered.
      onClose={() => {}}
      closeOnClickOutside={false}
      closeOnEscape={false}
      title={`Pascal holds: ${dealt.title}`}
      maxWidth="2xl"
      footer={footer}
    >
      <div className="qt-intervention space-y-4" data-testid="custom-tool-intervention">
        <p className="text-sm qt-text-secondary">
          {reached}. The cards are dealt but not yet shown — adjust what you like, then deal it. No one at the table
          will know you touched the deck.
          {waiting > 0 && <span className="qt-intervention-queue"> {waiting} more waiting.</span>}
        </p>

        {hold.eligible.params.length > 0 && (
          <ParamsSection hold={hold} run={run} dealt={dealt} overrides={overrides} pin={pin} reset={reset} clamped={preview.clampedParams} />
        )}

        {shown.has('roll') && (
          <Section title="The roll" pinned={overrides.roll !== undefined || overrides.dice !== undefined}
            onReset={() => setOverrides((prev) => unpin(unpin(prev, 'roll'), 'dice'))}
            dealt={dealt.rollForm === 'dice' ? dealt.diceBreakdown : formatNumber(dealt.raw)}>
            {run.rollForm === 'dice' ? (
              <div className="flex flex-wrap gap-2 items-center">
                {(run.diceRolls ?? []).map((face, i) => (
                  <input
                    key={i}
                    type="number"
                    aria-label={`Die ${i + 1}`}
                    className="qt-input w-16"
                    min={1}
                    max={hold.definition.diceSides}
                    value={face}
                    onChange={(e) => {
                      const faces = [...(overrides.dice ?? run.diceRolls ?? [])]
                      faces[i] = Number(e.target.value)
                      if (faces.every((f) => Number.isFinite(f))) pin({ dice: faces })
                    }}
                  />
                ))}
                <span className="text-xs qt-text-secondary">{run.diceBreakdown}</span>
              </div>
            ) : (
              <NumberField
                label="Raw draw"
                value={overrides.roll ?? run.raw}
                onChange={(n) => pin({ roll: n })}
              />
            )}
          </Section>
        )}

        {shown.has('value') && run.rollForm === 'range' && (
          <Section title="The value" pinned={overrides.value !== undefined} onReset={() => reset('value')} dealt={formatNumber(dealt.value)}>
            <NumberField label="Value after modifiers" value={overrides.value ?? run.value} onChange={(n) => pin({ value: n })} />
          </Section>
        )}

        {hold.definition.hasLlm && (shown.has('llmPrompt') || shown.has('llmAnswer')) && (
          <Section
            title="The consult"
            pinned={overrides.llmPrompt !== undefined || overrides.llmAnswer !== undefined}
            onReset={() => setOverrides((prev) => unpin(unpin(prev, 'llmPrompt'), 'llmAnswer'))}
            dealt={consults.length > 1 ? `asked ${consults.length} times` : undefined}
          >
            {shown.has('llmPrompt') && (
              <label className="block">
                <span className="text-xs qt-text-secondary">Prompt</span>
                <textarea
                  className="qt-textarea w-full font-mono text-xs"
                  rows={4}
                  value={overrides.llmPrompt ?? preview.promptNow ?? ''}
                  onChange={(e) => (e.target.value ? pin({ llmPrompt: e.target.value }) : reset('llmPrompt'))}
                />
              </label>
            )}
            {shown.has('llmAnswer') && (
              <div className="space-y-1">
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={(overrides.llmAnswer ?? run.llm)?.ok ?? false}
                    onChange={(e) =>
                      pin({ llmAnswer: { ok: e.target.checked, output: (overrides.llmAnswer ?? run.llm)?.output ?? '' } })
                    }
                  />
                  The oracle answered
                </label>
                <textarea
                  aria-label="Answer"
                  className="qt-textarea w-full text-sm"
                  rows={3}
                  value={(overrides.llmAnswer ?? run.llm)?.output ?? ''}
                  onChange={(e) => pin({ llmAnswer: { ok: (overrides.llmAnswer ?? run.llm)?.ok ?? true, output: e.target.value } })}
                />
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="qt-button qt-button-secondary"
                onClick={() => reaskMutation.mutate()}
                disabled={reaskMutation.isPending || busy}
              >
                {reaskMutation.isPending ? 'Asking…' : 'Re-ask'}
              </button>
              {preview.staleAnswer && <span className="qt-intervention-note">This answer was given to a different question.</span>}
            </div>
          </Section>
        )}

        {shown.has('outcome') && (
          <Section title="The outcome" pinned={overrides.outcomeIndex !== undefined} onReset={() => reset('outcomeIndex')} dealt={`row ${dealt.outcomeIndex + 1}`}>
            <ol className="space-y-1">
              {hold.definition.outcomes.map((outcome, index) => {
                const winning = index === run.outcomeIndex
                return (
                  <li key={index}>
                    <button
                      type="button"
                      aria-pressed={winning}
                      onClick={() => pin({ outcomeIndex: index })}
                      className={`qt-intervention-row qt-pascal-result qt-pascal-result--${outcome.state}${winning ? ' qt-intervention-row--winning' : ''}`}
                    >
                      <span className="font-mono text-xs">{index + 1}.</span>{' '}
                      <span className="text-xs">{summarizeWhen(outcome.when)}</span>{' '}
                      <span className="text-xs qt-text-secondary">→ {outcome.state}</span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </Section>
        )}

        {shown.has('message') && (
          <Section title="The message" pinned={overrides.message !== undefined} onReset={() => reset('message')}>
            <textarea
              aria-label="Message"
              className="qt-textarea w-full text-sm"
              rows={3}
              value={overrides.message ?? run.message}
              onChange={(e) => (e.target.value ? pin({ message: e.target.value }) : reset('message'))}
            />
          </Section>
        )}

        {shown.has('state') && (
          <Section title="The verdict" pinned={overrides.state !== undefined} onReset={() => reset('state')} dealt={dealt.state}>
            <select
              aria-label="State"
              className="qt-select"
              value={overrides.state ?? run.state}
              onChange={(e) => pin({ state: e.target.value as OutcomeState })}
            >
              {OUTCOME_STATES.map((state) => (
                <option key={state} value={state}>{state}</option>
              ))}
            </select>
          </Section>
        )}

        {hold.eligible.effects.length > 0 && (
          <EffectsSection effects={run.effects.filter((e) => hold.eligible.effects.includes(e.index))} overrides={overrides} setOverrides={setOverrides} />
        )}

        <PresentationSection hold={hold} shown={shown} run={run} overrides={overrides} pin={pin} reset={reset} />

        {preview.warnings.length > 0 && (
          <ul className="qt-intervention-note space-y-1">
            {preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        )}

        <div>
          <h3 className="text-xs uppercase tracking-wide qt-text-secondary mb-1">
            As it will be announced{pinnedCount > 0 ? ` — ${pinnedCount} change${pinnedCount === 1 ? '' : 's'} pinned` : ''}
          </h3>
          <div className={`qt-pascal-result qt-pascal-result--${run.state}`} data-testid="intervention-preview">
            <div className="text-xs font-semibold">
              {run.chipLabel ?? run.title}
              {run.visibility === 'whisper' ? ' · whispered' : ''}
              {run.announcer === 'character' && hold.characterName ? ` · in ${hold.characterName}'s voice` : ''}
            </div>
            <div className="text-sm whitespace-pre-wrap">{run.message}</div>
          </div>
        </div>
      </div>
    </BaseModal>
  )
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

interface SectionProps {
  title: string
  pinned: boolean
  onReset: () => void
  /** The value as first dealt, shown once the field has been changed. */
  dealt?: string
  children: React.ReactNode
}

function Section({ title, pinned, onReset, dealt, children }: Readonly<SectionProps>) {
  return (
    <section className={`qt-intervention-section${pinned ? ' qt-intervention-section--pinned' : ''}`}>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        {pinned && (
          <span className="text-xs qt-text-secondary">
            {dealt !== undefined ? `dealt: ${dealt} · ` : ''}
            <button type="button" className="qt-intervention-reset" onClick={onReset}>reset</button>
          </span>
        )}
      </div>
      {children}
    </section>
  )
}

function NumberField({ label, value, onChange }: Readonly<{ label: string; value: number; onChange: (n: number) => void }>) {
  // What the operator is typing, while they type; the server's figure otherwise.
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? formatNumber(value)
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-xs qt-text-secondary">{label}</span>
      <input
        type="number"
        step="any"
        className="qt-input w-32"
        value={text}
        onChange={(e) => {
          setDraft(e.target.value)
          const n = Number(e.target.value)
          if (e.target.value.trim() !== '' && Number.isFinite(n)) onChange(n)
        }}
        onBlur={() => setDraft(null)}
      />
    </label>
  )
}

interface ParamsSectionProps {
  hold: InterventionHoldView
  run: InterventionRunView
  dealt: InterventionRunView
  overrides: InterventionOverrides
  pin: (patch: InterventionOverrides) => void
  reset: (key: keyof InterventionOverrides) => void
  clamped: string[]
}

function ParamsSection({ hold, run, dealt, overrides, pin, reset, clamped }: Readonly<ParamsSectionProps>) {
  // The form wants literal defaults; the run's resolved values are exactly that.
  const parameters = useMemo(() => {
    const specs: Record<string, CustomToolParameterSpec> = {}
    for (const name of hold.eligible.params) {
      const declared = hold.definition.parameters[name]
      if (!declared) continue
      specs[name] = { ...declared, default: dealt.params[name] ?? '' }
    }
    return specs
  }, [hold, dealt.params])

  const values: ParameterFormValues = {}
  for (const name of Object.keys(parameters)) {
    const current = overrides.params?.[name] ?? run.params[name]
    values[name] = typeof current === 'boolean' ? current : String(current ?? '')
  }

  return (
    <Section
      title="Parameters"
      pinned={overrides.params !== undefined}
      onReset={() => reset('params')}
      dealt={Object.entries(dealt.params).filter(([n]) => n in parameters).map(([n, v]) => `${n} ${String(v)}`).join(', ')}
    >
      <CustomToolParamsForm
        parameters={parameters}
        values={values}
        idPrefix={`intervention-${hold.id}`}
        layout="stacked"
        onChange={(name, value) => {
          const coerced = coerceParamValues(parameters, { ...values, [name]: value })
          pin({ params: { ...(overrides.params ?? {}), [name]: coerced[name] } })
        }}
      />
      {clamped.length > 0 && (
        <p className="qt-intervention-note">Held to the declared bounds: {clamped.join(', ')}.</p>
      )}
    </Section>
  )
}

interface EffectsSectionProps {
  effects: InterventionEffectView[]
  overrides: InterventionOverrides
  setOverrides: React.Dispatch<React.SetStateAction<InterventionOverrides>>
}

function EffectsSection({ effects, overrides, setOverrides }: Readonly<EffectsSectionProps>) {
  const setPin = (index: number, next: EffectPin | null) =>
    setOverrides((prev) => {
      const all = { ...(prev.effects ?? {}) }
      if (next) all[String(index)] = next
      else delete all[String(index)]
      const { effects: _old, ...rest } = prev
      return Object.keys(all).length > 0 ? { ...rest, effects: all } : rest
    })

  return (
    <Section title="Consequences" pinned={overrides.effects !== undefined} onReset={() => setOverrides((prev) => unpin(prev, 'effects'))}>
      <ul className="space-y-2">
        {effects.map((effect) => {
          const pinned = overrides.effects?.[String(effect.index)]
          const mode = pinned?.mode ?? 'auto'
          const patch = (fields: Partial<EffectPin>) => setPin(effect.index, { mode, ...pinned, ...fields })
          return (
            <li key={effect.index} className="qt-intervention-effect">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono text-xs">{effect.label}</span>
                <span className="text-xs qt-text-secondary">
                  {effect.fired ? 'fires' : `does not fire${effect.skipped ? ` (${effect.skipped})` : ''}`}
                </span>
                <select
                  aria-label={`Effect ${effect.index + 1} mode`}
                  className="qt-select ml-auto"
                  value={mode}
                  onChange={(e) => {
                    const next = e.target.value as EffectPin['mode']
                    if (next === 'auto' && pinned && Object.keys(pinned).length === 1) setPin(effect.index, null)
                    else patch({ mode: next })
                  }}
                >
                  <option value="auto">Auto</option>
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </select>
              </div>
              {effect.fired && effect.kind === 'write' && (
                <input
                  aria-label={`Effect ${effect.index + 1} value`}
                  className="qt-input w-full mt-1 font-mono text-xs"
                  value={String(pinned?.value ?? effect.value ?? '')}
                  onChange={(e) => patch({ value: literalFrom(e.target.value) })}
                />
              )}
              {effect.fired && (effect.kind === 'wardrobe' || effect.kind === 'inventory') && (
                <textarea
                  aria-label={`Effect ${effect.index + 1} items`}
                  className="qt-textarea w-full mt-1 text-xs"
                  rows={2}
                  value={(pinned?.items ?? effect.items ?? []).join('\n')}
                  onChange={(e) => patch({ items: e.target.value.split('\n') })}
                />
              )}
              {effect.fired && effect.kind === 'log' && (
                <textarea
                  aria-label={`Effect ${effect.index + 1} log line`}
                  className="qt-textarea w-full mt-1 text-xs"
                  rows={2}
                  value={pinned?.log ?? effect.log ?? ''}
                  onChange={(e) => patch({ log: e.target.value })}
                />
              )}
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

interface PresentationSectionProps {
  hold: InterventionHoldView
  shown: Set<string>
  run: InterventionRunView
  overrides: InterventionOverrides
  pin: (patch: InterventionOverrides) => void
  reset: (key: keyof InterventionOverrides) => void
}

function PresentationSection({ hold, shown, run, overrides, pin, reset }: Readonly<PresentationSectionProps>) {
  const any = ['visibility', 'announcer', 'title', 'chipLabel'].some((key) => shown.has(key))
  if (!any) return null
  const pinned = ['visibility', 'announcer', 'title', 'chipLabel'].some(
    (key) => overrides[key as keyof InterventionOverrides] !== undefined,
  )
  return (
    <Section
      title="Presentation"
      pinned={pinned}
      onReset={() => {
        reset('visibility')
        reset('announcer')
        reset('title')
        reset('chipLabel')
      }}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {shown.has('visibility') && (
          <label className="text-xs">
            <span className="qt-text-secondary">Heard by</span>
            <select
              className="qt-select w-full"
              value={overrides.visibility ?? run.visibility}
              onChange={(e) => pin({ visibility: e.target.value as 'public' | 'whisper' })}
            >
              <option value="public">The whole table</option>
              <option value="whisper">A whisper</option>
            </select>
          </label>
        )}
        {shown.has('announcer') && hold.hasCharacter && (
          <label className="text-xs">
            <span className="qt-text-secondary">Announced by</span>
            <select
              className="qt-select w-full"
              value={overrides.announcer ?? run.announcer}
              onChange={(e) => pin({ announcer: e.target.value as 'pascal' | 'character' })}
            >
              <option value="pascal">Pascal</option>
              <option value="character">{hold.characterName ?? 'The character'}</option>
            </select>
          </label>
        )}
        {shown.has('title') && (
          <label className="text-xs">
            <span className="qt-text-secondary">Title</span>
            <input
              className="qt-input w-full"
              value={overrides.title ?? run.title}
              onChange={(e) => (e.target.value ? pin({ title: e.target.value }) : reset('title'))}
            />
          </label>
        )}
        {shown.has('chipLabel') && (
          <label className="text-xs">
            <span className="qt-text-secondary">Chip label</span>
            <input
              className="qt-input w-full"
              value={overrides.chipLabel ?? run.chipLabel ?? ''}
              onChange={(e) => (e.target.value ? pin({ chipLabel: e.target.value }) : reset('chipLabel'))}
            />
          </label>
        )}
      </div>
    </Section>
  )
}

export default CustomToolInterventionDialog
