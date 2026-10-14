'use client'

/**
 * The progression editor — one modal, one entry.
 *
 * The whole reason this ships in v1 rather than leaving people to the vault
 * file: hand-typing ISO timestamps into JSON is the wrong surface for "you
 * became pregnant on 1 August". So the times are `datetime-local` inputs in
 * the browser's own zone (converted to a real instant on save), the span has a
 * duration shortcut, and the template carries a live preview rendered by the
 * same client-safe engine the server prompts with — the author sees the exact
 * sentence their character will read.
 *
 * The id is coerced from the name on create and immutable afterwards: a Pascal
 * tool file addresses `progress.cannon.complete` and would be broken by a
 * rename, which is the whole point of separating id from display name.
 *
 * The form seeds itself from `editing` ONCE, at mount. Re-seating it from an
 * effect when the prop changes would be the same thing by a worse road; the
 * parent keys this component on the entry being edited, so opening a different
 * one mounts a fresh form and half-typed edits never bleed between entries.
 */

import { useEffect, useMemo, useState } from 'react'

import { Icon } from '@/components/ui/icon'
import {
  UNIT_MS,
  deriveProgression,
  renderProgressionReport,
} from '@/lib/progressions/engine'
import {
  MAX_PROGRESSION_DESCRIPTION_LENGTH,
  MAX_PROGRESSION_NAME_LENGTH,
  MAX_REPORT_TEMPLATE_LENGTH,
  PROGRESSION_ID_PATTERN,
  ProgressionSchema,
  TimeIncrementSchema,
  type Progression,
  type TimeIncrement,
} from '@/lib/progressions/schema'

import { idFromName } from './useCharacterProgressions'

/** How a cadence is chosen in the form; `<n><unit>` splits into its two parts. */
type CadenceMode = 'turn' | 'increment' | 'period'

const PERIOD_UNITS: Array<{ value: string; label: string }> = [
  { value: 's', label: 'seconds' },
  { value: 'm', label: 'minutes' },
  { value: 'h', label: 'hours' },
  { value: 'd', label: 'days' },
  { value: 'w', label: 'weeks' },
]

const INCREMENTS = TimeIncrementSchema.options

const PLACEHOLDER_LEGEND: Array<[string, string]> = [
  ['{{name}}', 'the progression’s name'],
  ['{{description}}', 'your sentence above, or nothing'],
  ['{{elapsed}}', '“20 weeks, 3 days”'],
  ['{{elapsedWhole}}', '“20 weeks”'],
  ['{{remaining}}', 'the same, counting down'],
  ['{{remainingWhole}}', 'whole units only'],
  ['{{percent}}', 'a whole number, 0–100'],
  ['{{quantity}}', '“0.3/1.0 MJ”, or nothing'],
  ['{{start}}', 'when it began (wall clock)'],
  ['{{end}}', 'when it ends (wall clock)'],
  ['{{increment}}', 'the unit word — “week”'],
]

export interface ProgressionEditorModalProps {
  /** The entry being edited, with its id. Null = creating a fresh one. */
  editing: { id: string; progression: Progression } | null
  /** Ids already in use, so a create cannot silently overwrite one. */
  existingIds: string[]
  saving: boolean
  onClose: () => void
  onSave: (id: string, progression: Progression) => void
}

/** The form's own state — every field a string, as an input gives it. */
interface FormState {
  id: string
  name: string
  description: string
  start: string
  end: string
  increment: TimeIncrement
  percentageReport: boolean
  cadenceMode: CadenceMode
  periodCount: string
  periodUnit: string
  hasQuantity: boolean
  quantityTotal: string
  quantityUnit: string
  quantityPrecision: string
  reportTemplate: string
  onComplete: 'keep' | 'once'
}

/** An ISO instant as a `datetime-local` value, in the BROWSER's zone. */
function toLocalInput(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  const local = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

/** The reverse: a `datetime-local` reading as a real instant with an offset. */
function fromLocalInput(value: string): string | null {
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) return null
  return new Date(ms).toISOString()
}

function initialForm(editing: ProgressionEditorModalProps['editing']): FormState {
  if (!editing) {
    const now = Date.now()
    return {
      id: '',
      name: '',
      description: '',
      start: toLocalInput(new Date(now).toISOString()),
      end: toLocalInput(new Date(now + UNIT_MS.hour).toISOString()),
      increment: 'minute',
      percentageReport: true,
      cadenceMode: 'turn',
      periodCount: '1',
      periodUnit: 'h',
      hasQuantity: false,
      quantityTotal: '1',
      quantityUnit: '',
      quantityPrecision: '1',
      reportTemplate: '',
      onComplete: 'keep',
    }
  }

  const p = editing.progression
  const period = /^([1-9]\d{0,4})([smhdw])$/.exec(p.reportFrequency)

  return {
    id: editing.id,
    name: p.name,
    description: p.description ?? '',
    start: toLocalInput(p.startTime),
    end: toLocalInput(p.endTime),
    increment: p.timeIncrement,
    percentageReport: p.percentageReport,
    cadenceMode: p.reportFrequency === 'turn' ? 'turn' : p.reportFrequency === 'increment' ? 'increment' : 'period',
    periodCount: period?.[1] ?? '1',
    periodUnit: period?.[2] ?? 'h',
    hasQuantity: p.quantity !== undefined,
    quantityTotal: String(p.quantity?.total ?? 1),
    quantityUnit: p.quantity?.unit ?? '',
    quantityPrecision: String(p.quantity?.precision ?? 1),
    reportTemplate: p.reportTemplate ?? '',
    onComplete: p.onComplete,
  }
}

/** The form as a progression, or the first thing wrong with it. */
function toProgression(form: FormState): { ok: true; value: Progression } | { ok: false; reason: string } {
  const startTime = fromLocalInput(form.start)
  const endTime = fromLocalInput(form.end)
  if (!startTime) return { ok: false, reason: 'The start needs a date and a time.' }
  if (!endTime) return { ok: false, reason: 'The end needs a date and a time.' }

  const candidate: Record<string, unknown> = {
    name: form.name.trim(),
    startTime,
    endTime,
    timeIncrement: form.increment,
    percentageReport: form.percentageReport,
    reportFrequency:
      form.cadenceMode === 'period' ? `${form.periodCount}${form.periodUnit}` : form.cadenceMode,
    onComplete: form.onComplete,
  }
  if (form.description.trim() !== '') candidate.description = form.description.trim()
  if (form.reportTemplate.trim() !== '') candidate.reportTemplate = form.reportTemplate.trim()
  if (form.hasQuantity) {
    candidate.quantity = {
      total: Number(form.quantityTotal),
      unit: form.quantityUnit.trim(),
      precision: Number(form.quantityPrecision),
    }
  }

  const parsed = ProgressionSchema.safeParse(candidate)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, reason: `${issue.path.join('.') || 'This entry'}: ${issue.message}` }
  }
  return { ok: true, value: parsed.data }
}

export function ProgressionEditorModal({
  editing,
  existingIds,
  saving,
  onClose,
  onSave,
}: Readonly<ProgressionEditorModalProps>) {
  const [form, setForm] = useState<FormState>(() => initialForm(editing))
  const [idTouched, setIdTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The clock the live preview reads. Held in state and advanced by an
  // interval rather than read during render: `Date.now()` in a render body is
  // impure, and a preview frozen beside an advancing recharge would be a
  // worse lie than none.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const isCreate = editing === null
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  // On create the id follows the name until the author edits it themselves —
  // the subprompts precedent. On edit it never moves at all: a Pascal tool
  // file addresses the id, and a rename would break it silently.
  const effectiveId = isCreate && !idTouched ? idFromName(form.name) : form.id

  /** The line this progression would produce right now, for the live preview. */
  const preview = useMemo(() => {
    const built = toProgression(form)
    if (!built.ok) return null
    return renderProgressionReport(built.value, deriveProgression(effectiveId || 'preview', built.value, nowMs))
  }, [form, effectiveId, nowMs])

  const handleSave = () => {
    const id = effectiveId.trim()
    if (!PROGRESSION_ID_PATTERN.test(id)) {
      setError('The id must be lowercase, start with a letter, and hold only letters, digits, _ and -.')
      return
    }
    if (isCreate && existingIds.includes(id)) {
      setError(`This character already carries a progression called “${id}”.`)
      return
    }
    const built = toProgression(form)
    if (!built.ok) {
      setError(built.reason)
      return
    }
    setError(null)
    onSave(id, built.value)
  }

  /** "Ends N units after the start" — the shortcut nobody wants to do by hand. */
  const applyDuration = (count: number, unit: TimeIncrement) => {
    const startMs = Date.parse(form.start)
    if (Number.isNaN(startMs)) return
    setForm((prev) => ({ ...prev, end: toLocalInput(new Date(startMs + count * UNIT_MS[unit]).toISOString()) }))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center qt-bg-overlay p-4">
      <div className="qt-card qt-bg-card w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
        <div className="flex items-start justify-between">
          <h3 className="qt-heading-4">{isCreate ? 'New progression' : `Edit “${form.name || effectiveId}”`}</h3>
          <button type="button" onClick={onClose} className="qt-button-icon qt-button-ghost" aria-label="Close">
            <Icon name="close" className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="qt-text-small">Name</span>
            <input
              type="text"
              value={form.name}
              maxLength={MAX_PROGRESSION_NAME_LENGTH}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Cannon recharge"
              className="qt-input w-full"
            />
          </label>

          <label className="space-y-1">
            <span className="qt-text-small">
              Identifier{' '}
              <span className="qt-text-secondary">
                {isCreate ? '(how a tool addresses it)' : '(fixed — tools address it)'}
              </span>
            </span>
            <input
              type="text"
              value={effectiveId}
              disabled={!isCreate}
              onChange={(e) => {
                setIdTouched(true)
                set('id', e.target.value)
              }}
              placeholder="cannon"
              className="qt-input w-full font-mono"
            />
          </label>
        </div>

        <label className="space-y-1 block">
          <span className="qt-text-small">
            Description <span className="qt-text-secondary">— one sentence, in the second person</span>
          </span>
          <textarea
            value={form.description}
            maxLength={MAX_PROGRESSION_DESCRIPTION_LENGTH}
            onChange={(e) => set('description', e.target.value)}
            rows={2}
            placeholder="You are carrying a child."
            className="qt-textarea w-full"
          />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="qt-text-small">Begins</span>
            <input
              type="datetime-local"
              value={form.start}
              onChange={(e) => set('start', e.target.value)}
              className="qt-input w-full"
            />
          </label>
          <label className="space-y-1">
            <span className="qt-text-small">Ends</span>
            <input
              type="datetime-local"
              value={form.end}
              onChange={(e) => set('end', e.target.value)}
              className="qt-input w-full"
            />
          </label>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="qt-text-small qt-text-secondary">Or ends</span>
          {([
            [10, 'minute'],
            [1, 'hour'],
            [1, 'day'],
            [1, 'week'],
            [9, 'month'],
          ] as Array<[number, TimeIncrement]>).map(([count, unit]) => (
            <button
              key={`${count}${unit}`}
              type="button"
              onClick={() => applyDuration(count, unit)}
              className="qt-button qt-button-ghost qt-button-sm"
            >
              +{count} {unit}
              {count === 1 ? '' : 's'}
            </button>
          ))}
          <span className="qt-text-small qt-text-secondary">after it begins.</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="qt-text-small">
              Spoken in <span className="qt-text-secondary">— the unit the report uses</span>
            </span>
            <select
              value={form.increment}
              onChange={(e) => set('increment', e.target.value as TimeIncrement)}
              className="qt-select w-full"
            >
              {INCREMENTS.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}s
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="qt-text-small">Once it finishes</span>
            <select
              value={form.onComplete}
              onChange={(e) => set('onComplete', e.target.value as 'keep' | 'once')}
              className="qt-select w-full"
            >
              <option value="keep">keep reporting it</option>
              <option value="once">say so once, then go quiet</option>
            </select>
          </label>
        </div>

        <fieldset className="space-y-2">
          <legend className="qt-text-small">Mentioned</legend>
          {([
            ['turn', 'every turn'],
            ['increment', `whenever the ${form.increment} count changes`],
            ['period', 'at most once every'],
          ] as Array<[CadenceMode, string]>).map(([mode, label]) => (
            <label key={mode} className="flex items-center gap-2 qt-text-small">
              <input
                type="radio"
                name="cadence"
                checked={form.cadenceMode === mode}
                onChange={() => set('cadenceMode', mode)}
              />
              {label}
              {mode === 'period' && (
                <span className="flex items-center gap-1">
                  <input
                    type="number"
                    min={1}
                    max={99999}
                    value={form.periodCount}
                    onChange={(e) => set('periodCount', e.target.value)}
                    disabled={form.cadenceMode !== 'period'}
                    className="qt-input qt-input-sm w-20"
                    aria-label="Cadence count"
                  />
                  <select
                    value={form.periodUnit}
                    onChange={(e) => set('periodUnit', e.target.value)}
                    disabled={form.cadenceMode !== 'period'}
                    className="qt-select qt-select-sm w-28"
                    aria-label="Cadence unit"
                  >
                    {PERIOD_UNITS.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </span>
              )}
            </label>
          ))}
          <p className="qt-hint">
            A change you make here, or one a tool makes, is always announced on the very next turn — the cadence
            only governs the quiet stretches in between.
          </p>
        </fieldset>

        <label className="flex items-center gap-2 qt-text-small">
          <input
            type="checkbox"
            checked={form.percentageReport}
            onChange={(e) => set('percentageReport', e.target.checked)}
          />
          Include the percentage in the default wording
        </label>

        <div className="space-y-2">
          <label className="flex items-center gap-2 qt-text-small">
            <input
              type="checkbox"
              checked={form.hasQuantity}
              onChange={(e) => set('hasQuantity', e.target.checked)}
            />
            It fills a measurable amount (megajoules, litres, rounds)
          </label>
          {form.hasQuantity && (
            <div className="grid grid-cols-3 gap-2">
              <label className="space-y-1">
                <span className="qt-text-small">Full amount</span>
                <input
                  type="number"
                  step="any"
                  value={form.quantityTotal}
                  onChange={(e) => set('quantityTotal', e.target.value)}
                  className="qt-input w-full"
                />
              </label>
              <label className="space-y-1">
                <span className="qt-text-small">Unit</span>
                <input
                  type="text"
                  maxLength={16}
                  value={form.quantityUnit}
                  onChange={(e) => set('quantityUnit', e.target.value)}
                  placeholder="MJ"
                  className="qt-input w-full"
                />
              </label>
              <label className="space-y-1">
                <span className="qt-text-small">Decimals</span>
                <input
                  type="number"
                  min={0}
                  max={6}
                  value={form.quantityPrecision}
                  onChange={(e) => set('quantityPrecision', e.target.value)}
                  className="qt-input w-full"
                />
              </label>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <label className="space-y-1 block">
            <span className="qt-text-small">
              How it&rsquo;s told <span className="qt-text-secondary">— leave blank for the default wording</span>
            </span>
            <textarea
              value={form.reportTemplate}
              maxLength={MAX_REPORT_TEMPLATE_LENGTH}
              onChange={(e) => set('reportTemplate', e.target.value)}
              rows={2}
              placeholder="{{description}} You are {{elapsedWhole}} along; due in {{remaining}}."
              className="qt-textarea w-full"
            />
          </label>
          <details className="qt-text-small">
            <summary className="cursor-pointer qt-text-secondary">What you may write in it</summary>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 mt-2">
              {PLACEHOLDER_LEGEND.map(([token, meaning]) => (
                <div key={token} className="contents">
                  <dt className="font-mono text-xs qt-text">{token}</dt>
                  <dd className="text-xs qt-text-secondary">{meaning}</dd>
                </div>
              ))}
            </dl>
            <p className="qt-hint mt-2">
              This wording covers the stretch while it is running. Before it starts and after it finishes the
              report says so in its own words, which no template overrides.
            </p>
          </details>
        </div>

        {preview && (
          <div className="qt-card p-3">
            <p className="qt-text-small qt-text-secondary mb-1">As {form.name || 'this character'} would read it now:</p>
            <p className="qt-text-small italic">{preview}</p>
          </div>
        )}

        {error && <p className="qt-text-small qt-text-destructive">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="qt-button-secondary" disabled={saving}>
            Cancel
          </button>
          <button type="button" onClick={handleSave} className="qt-button-primary" disabled={saving}>
            {saving ? 'Saving…' : isCreate ? 'Add progression' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
