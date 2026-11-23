'use client'

/**
 * Calliope's Atelier — the value controls, keyed by type (Spec E, Stage 2).
 *
 * A row (`TokenRow`, or a primitive's row) owns everything rows share and
 * takes the control for one mode's value from `ValueControl`, which picks by
 * type. Every typed control is built on the engine's parser for its type
 * (`lib/themes/engine/values/`) and has a text form (decision 4): it opens in
 * text when the value is one the parser does not understand, and it never
 * rewrites a value it did not parse — a typed control commits only when the
 * person changes something in it, and then writes the formatted structure.
 * Text is checked by the engine's type check, the same message the server
 * gives, and a value that fails it is not applied.
 *
 * Every field has an accessible name built from the row's `label` ("Card,
 * light"), and every number has a field to type in — a slider is never the
 * only way to set one.
 *
 * @module components/theme-editor/controls
 */

import { createContext, useContext, useId, useState, type ReactNode } from 'react'
import {
  DURATION_UNITS,
  EASING_KEYWORDS,
  FONT_WEIGHT_KEYWORDS,
  LENGTH_KEYWORDS,
  LENGTH_UNITS,
  collapseCorners,
  defaultShadowLayer,
  formatBlur,
  formatDuration,
  formatFontStack,
  formatFontWeight,
  formatImage,
  formatLengthList,
  formatNumber,
  formatOpacity,
  formatShadow,
  formatTransition,
  formatZIndex,
  isVarReference,
  opacityFraction,
  parseBlur,
  parseDuration,
  parseFontStack,
  parseFontWeight,
  parseImage,
  parseLength,
  parseLengthList,
  parseOpacity,
  parseShadow,
  parseTransition,
  parseZIndex,
  radiusCorners,
  type Blur,
  type FontStack,
  type FontWeight,
  type ImageValue,
  type LengthPart,
  type Quantity,
  type Shadow,
  type ShadowLayer,
  type TokenType,
  type Transition,
  type TransitionLayer,
} from '@/lib/themes/engine/client'
import {
  EMPTY_RESOURCES,
  SYSTEM_FONT_STACKS,
  appendFamilies,
  draftFontWeights,
  isAcceptedColour,
  isEasing,
  moveItem,
  pickedValue,
  pickerHex,
  valueProblem,
  weightNumber,
  type DraftResources,
} from './model'

/** The draft's fonts and images, for the font and image controls. */
export const DraftResourcesContext = createContext<DraftResources>(EMPTY_RESOURCES)

export interface ControlProps {
  type: TokenType
  /** Names the value for assistive technology: the row and mode ("Card, light"). */
  label: string
  /** For a keyword type: the words it may be. */
  options?: readonly string[] | null
  /** The value as written (empty for an unset optional token). */
  value: string
  /** The value with references substituted, when it resolves. */
  literal: string | null
  /** Shown in an empty field, and where a typed control starts: what "unset" means for an optional token. */
  placeholder?: string
  /** For a font weight: the first family of the font in force. */
  familyInForce?: string | null
  onCommit: (value: string) => void
}

/** Why typed `text` will not be applied as a value of `type`, or null when it will. */
function refusal(type: TokenType, text: string, options?: readonly string[] | null): string | null {
  const problem = valueProblem(type, text, options ?? undefined)
  if (!problem) return null
  return type === 'color' ? 'Not a colour the atelier recognises; it will not be applied.' : `The atelier demurs: ${problem}. It will not be applied.`
}

// ---------------------------------------------------------------------------
// Small fields the controls are made of.

/**
 * A text field that commits on Enter or when it loses focus, and only text
 * `accept` passes; Escape puts back `value`. A value changed elsewhere
 * replaces what it shows.
 */
function CommitText({
  value,
  label,
  accept,
  message,
  onCommit,
  placeholder,
  list,
  className = '',
}: {
  value: string
  label: string
  accept: (text: string) => boolean
  /** What to say under a refused text. */
  message: (text: string) => string | null
  onCommit: (text: string) => void
  placeholder?: string
  list?: string
  className?: string
}) {
  const [text, setText] = useState(value)
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    setText(value)
  }
  const errorId = useId()
  const edited = text.trim() !== value.trim()
  const shown = edited && text.trim() !== '' ? message(text.trim()) : null

  const commit = () => {
    const next = text.trim()
    if (!edited) return
    if (next === '' || !accept(next)) {
      if (next === '') setText(value)
      return
    }
    onCommit(next)
  }

  return (
    <div className={`min-w-0 flex-1 ${className}`}>
      <input
        type="text"
        className="qt-input w-full font-mono qt-text-xs"
        value={text}
        placeholder={placeholder}
        spellCheck={false}
        list={list}
        aria-label={label}
        aria-invalid={shown ? true : undefined}
        aria-describedby={shown ? errorId : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape') {
            setText(value)
          }
        }}
      />
      {shown && (
        <p id={errorId} className="qt-text-xs qt-text-destructive mt-1">
          {shown}
        </p>
      )}
    </div>
  )
}

/**
 * A number to type in. It commits each number it can read inside the
 * bounds, and keeps what is being typed ("1.") until the value it shows
 * changes elsewhere.
 */
function NumberField({
  value,
  label,
  onChange,
  min,
  max,
  step = 'any',
  integer = false,
}: {
  value: number
  label: string
  onChange: (n: number) => void
  min?: number
  max?: number
  step?: number | 'any'
  integer?: boolean
}) {
  const [text, setText] = useState(formatNumber(value))
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    if (Number(text) !== value) setText(formatNumber(value))
  }
  const read = (t: string): number | null => {
    if (t.trim() === '') return null
    const n = Number(t)
    if (!Number.isFinite(n) || (integer && !Number.isInteger(n))) return null
    if ((min !== undefined && n < min) || (max !== undefined && n > max)) return null
    return n
  }
  return (
    <input
      type="number"
      className="qt-input qt-text-xs w-24 flex-shrink-0"
      value={text}
      min={min}
      max={max}
      step={step}
      aria-label={label}
      aria-invalid={read(text) === null ? true : undefined}
      onChange={(e) => {
        setText(e.target.value)
        const n = read(e.target.value)
        if (n !== null && n !== value) onChange(n)
      }}
      onBlur={() => {
        if (read(text) === null) setText(formatNumber(value))
      }}
    />
  )
}

/** A select of plain words. */
function WordSelect({
  value,
  label,
  words,
  onChange,
  describe,
}: {
  value: string
  label: string
  words: readonly string[]
  onChange: (word: string) => void
  describe?: (word: string) => string
}) {
  return (
    <select className="qt-select qt-text-xs" value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}>
      {words.map((w) => (
        <option key={w} value={w}>
          {describe ? describe(w) : w}
        </option>
      ))}
    </select>
  )
}

const KEYWORD_PREFIX = 'kw:'
const LENGTH_KEYWORD_LIST = [...LENGTH_KEYWORDS]

/**
 * One length: a number with its unit, or one of the length keywords the
 * type check allows. A part that is a `var()` reference is shown as text.
 */
function LengthPartField({
  part,
  label,
  onChange,
  keywords = true,
  min,
}: {
  part: LengthPart
  label: string
  onChange: (part: LengthPart) => void
  keywords?: boolean
  min?: number
}) {
  // The last amount shown, so a unit chosen after a keyword keeps it.
  const [lastNumber, setLastNumber] = useState(part.kind === 'number' ? part.number : 0)
  if (part.kind === 'number' && part.number !== lastNumber) setLastNumber(part.number)

  if (part.kind === 'reference') {
    return (
      <CommitText
        value={part.text}
        label={`${label}, as text`}
        accept={(t) => parseLength(t, { keywords }) !== null}
        message={(t) => (parseLength(t, { keywords }) ? null : `“${t}” is not a length. It will not be applied.`)}
        onCommit={(t) => onChange(parseLength(t, { keywords })!)}
      />
    )
  }

  const units: string[] = [...LENGTH_UNITS]
  if (part.kind === 'number' && part.unit === '') units.unshift('')
  const selectValue = part.kind === 'keyword' ? `${KEYWORD_PREFIX}${part.word}` : part.unit
  const onUnit = (choice: string) => {
    if (choice.startsWith(KEYWORD_PREFIX)) onChange({ kind: 'keyword', word: choice.slice(KEYWORD_PREFIX.length) })
    else onChange({ kind: 'number', number: choice === '' ? 0 : lastNumber, unit: choice })
  }
  return (
    <span className="inline-flex items-center gap-1 min-w-0">
      {part.kind === 'number' && (
        <NumberField
          value={part.number}
          label={`${label}, amount`}
          min={min}
          onChange={(n) => onChange({ kind: 'number', number: n, unit: part.unit === '' && n !== 0 ? 'px' : part.unit })}
        />
      )}
      <select className="qt-select qt-text-xs" value={selectValue} aria-label={`${label}, unit`} onChange={(e) => onUnit(e.target.value)}>
        {units.map((u) => (
          <option key={u || 'none'} value={u}>
            {u === '' ? '(no unit)' : u}
          </option>
        ))}
        {keywords &&
          LENGTH_KEYWORD_LIST.map((k) => (
            <option key={k} value={`${KEYWORD_PREFIX}${k}`}>
              {k}
            </option>
          ))}
      </select>
    </span>
  )
}

/** A colour inside a larger value (a shadow layer's): a picker and the text, which may also be a `var()`. */
function InlineColour({ value, label, onChange }: { value: string; label: string; onChange: (colour: string) => void }) {
  const hex = pickerHex(value)
  const accept = (t: string) => isAcceptedColour(t) || /^var\(--[\w-]+(\s*,[^)]*)?\)$/.test(t) || /^(currentcolor|transparent)$/i.test(t)
  return (
    <span className="flex items-start gap-1 min-w-0 flex-1">
      <input
        type="color"
        className="w-8 h-8 p-0 border qt-border-default rounded cursor-pointer flex-shrink-0"
        value={hex ?? '#000000'}
        aria-label={`${label} picker`}
        onChange={(e) => onChange(pickedValue(e.target.value, value))}
      />
      <CommitText
        value={value}
        label={label}
        accept={accept}
        message={(t) => (accept(t) ? null : 'Not a colour the atelier recognises; it will not be applied.')}
        onCommit={onChange}
      />
    </span>
  )
}

/** Move up, move down and remove, for one item of a list. */
function ItemButtons({
  label,
  index,
  count,
  onMove,
  onRemove,
  canRemove = true,
}: {
  label: string
  index: number
  count: number
  onMove: (by: number) => void
  onRemove: () => void
  canRemove?: boolean
}) {
  return (
    <span className="inline-flex gap-1 flex-shrink-0">
      <button type="button" className="qt-button qt-button-ghost qt-button-sm" disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move ${label} up`}>
        ↑
      </button>
      <button type="button" className="qt-button qt-button-ghost qt-button-sm" disabled={index === count - 1} onClick={() => onMove(1)} aria-label={`Move ${label} down`}>
        ↓
      </button>
      <button type="button" className="qt-button qt-button-ghost qt-button-sm" disabled={!canRemove} onClick={onRemove} aria-label={`Remove ${label}`}>
        ✕
      </button>
    </span>
  )
}

// ---------------------------------------------------------------------------
// The text form, and the frame every typed control sits in.

/** The value as text, checked by the engine's type check. */
export function TextControl({ type, label, options, value, placeholder, onCommit }: ControlProps) {
  return (
    <CommitText
      value={value}
      label={`${label} value`}
      placeholder={placeholder}
      accept={(t) => refusal(type, t, options) === null}
      message={(t) => refusal(type, t, options)}
      onCommit={onCommit}
    />
  )
}

/**
 * The frame of a typed control: the controls for a value its parser reads,
 * the text form for one it does not (with a word saying so), and a toggle
 * between the two. The controls start from the value in force, the
 * placeholder when the token is unset, or the literal when the value only
 * follows another; `render` gets the parsed structure
 * and a setter that formats and commits it when it differs from the value.
 */
function Typed<T>({
  props,
  parse,
  format,
  render,
}: {
  props: ControlProps
  parse: (value: string) => T | null
  format: (structure: T) => string
  render: (structure: T, set: (next: T) => void) => ReactNode
}) {
  const { label, value, literal, placeholder, onCommit } = props
  // A value that only follows another (`var(--p-ink)`) starts the controls
  // from what it comes to, so changing one gives it a value of its own.
  const follows = isVarReference(value.trim()) && literal !== null && literal.trim() !== ''
  const source = value.trim() === '' ? (placeholder ?? '') : follows ? (literal as string) : value
  const parsed = source.trim() === '' ? null : parse(source)
  const [chosenText, setChosenText] = useState(false)
  const asText = parsed === null || chosenText

  const set = (next: T) => {
    const formatted = format(next)
    if (formatted !== value) onCommit(formatted)
  }

  return (
    <div className="min-w-0 flex-1 space-y-1">
      {asText ? <TextControl {...props} /> : render(parsed as T, set)}
      {parsed === null && source.trim() !== '' ? (
        <p className="qt-text-xs qt-text-muted">This value is beyond the controls, so it is shown as written and left alone until you change it.</p>
      ) : (
        <button
          type="button"
          className="qt-button qt-button-ghost qt-button-sm"
          onClick={() => setChosenText(!chosenText)}
          aria-label={asText ? `${label}: use the controls` : `${label}: edit as text`}
        >
          {asText ? 'Use the controls' : 'Edit as text'}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// One control per type.

/** A colour picker beside the text field. The picker keeps the alpha of the value it replaces. */
export function ColorControl(props: ControlProps) {
  const { label, literal, onCommit } = props
  const hex = pickerHex(literal)
  return (
    <div className="flex items-start gap-2 min-w-0 flex-1">
      <input
        type="color"
        className="w-8 h-8 p-0 border qt-border-default rounded cursor-pointer flex-shrink-0"
        value={hex ?? '#000000'}
        aria-label={`${label} colour picker`}
        onChange={(e) => onCommit(pickedValue(e.target.value, literal))}
      />
      <TextControl {...props} />
    </div>
  )
}

const CORNERS = ['top left', 'top right', 'bottom right', 'bottom left'] as const

/** One to four lengths; a radius can be split into four corners. */
export function LengthControl(props: ControlProps) {
  const [apart, setApart] = useState(false)
  const isRadius = props.type === 'radius'
  return (
    <Typed
      props={props}
      parse={(v) => parseLengthList(v)}
      format={formatLengthList}
      render={(parts, set) => {
        if (isRadius) {
          const split = apart || parts.length > 1
          const corners = radiusCorners(parts)
          return (
            <div className="space-y-1 @container">
              {split ? (
                <div className="grid gap-1 @sm:grid-cols-2">
                  {CORNERS.map((corner, i) => (
                    <label key={corner} className="flex items-center gap-1 qt-text-xs qt-text-secondary">
                      <span className="w-20 flex-shrink-0">{corner}</span>
                      <LengthPartField
                        part={corners[i]}
                        label={`${props.label}, ${corner}`}
                        min={0}
                        onChange={(p) => {
                          const next = [...corners] as typeof corners
                          next[i] = p
                          set(collapseCorners(next))
                        }}
                      />
                    </label>
                  ))}
                </div>
              ) : (
                <LengthPartField part={parts[0]} label={props.label} min={0} onChange={(p) => set([p])} />
              )}
              <label className="flex items-center gap-1 qt-text-xs qt-text-secondary">
                <input
                  type="checkbox"
                  checked={split}
                  onChange={(e) => {
                    setApart(e.target.checked)
                    if (!e.target.checked && parts.length > 1) set([corners[0]])
                  }}
                />
                Each corner its own
              </label>
            </div>
          )
        }
        return (
          <div className="flex flex-wrap gap-2">
            {parts.map((p, i) => (
              <LengthPartField
                key={i}
                part={p}
                label={parts.length > 1 ? `${props.label}, part ${i + 1}` : props.label}
                onChange={(next) => set(parts.map((q, j) => (j === i ? next : q)))}
              />
            ))}
          </div>
        )
      }}
    />
  )
}

const ZERO: LengthPart = { kind: 'number', number: 0, unit: '' }

function ShadowLayerFields({
  layer,
  label,
  onChange,
}: {
  layer: ShadowLayer
  label: string
  onChange: (layer: ShadowLayer) => void
}) {
  const field = (key: 'x' | 'y' | 'blur' | 'spread', name: string, min?: number) => (
    <label className="flex items-center gap-1 qt-text-xs qt-text-secondary">
      <span className="w-14 flex-shrink-0">{name}</span>
      <LengthPartField
        part={layer[key] ?? ZERO}
        label={`${label}, ${name.toLowerCase()}`}
        keywords={false}
        min={min}
        onChange={(p) => onChange({ ...layer, [key]: p })}
      />
    </label>
  )
  return (
    <div className="space-y-1 @container">
      <div className="grid gap-1 @sm:grid-cols-2">
        {field('x', 'Across')}
        {field('y', 'Down')}
        {field('blur', 'Blur', 0)}
        {field('spread', 'Spread')}
      </div>
      <div className="flex items-start gap-2 flex-wrap">
        <InlineColour value={layer.color ?? 'currentcolor'} label={`${label}, colour`} onChange={(color) => onChange({ ...layer, color })} />
        <label className="flex items-center gap-1 qt-text-xs qt-text-secondary pt-2">
          <input type="checkbox" checked={layer.inset} onChange={(e) => onChange({ ...layer, inset: e.target.checked })} />
          Inset
        </label>
      </div>
    </div>
  )
}

/** A list of shadow layers, or none. */
export function ShadowControl(props: ControlProps) {
  return (
    <Typed<Shadow>
      props={props}
      parse={parseShadow}
      format={formatShadow}
      render={(shadow, set) => (
        <div className="space-y-2">
          {shadow.layers.length === 0 && <p className="qt-text-xs qt-text-muted">No shadow at all.</p>}
          {shadow.layers.map((layer, i) => {
            const name = `${props.label}, layer ${i + 1}`
            return (
              <fieldset key={i} className="border qt-border-default rounded p-2 space-y-1">
                <legend className="qt-text-label-xs px-1 flex items-center gap-2">
                  Layer {i + 1}
                  <ItemButtons
                    label={name}
                    index={i}
                    count={shadow.layers.length}
                    onMove={(by) => set({ layers: moveItem(shadow.layers, i, by) })}
                    onRemove={() => set({ layers: shadow.layers.filter((_, j) => j !== i) })}
                  />
                </legend>
                <ShadowLayerFields layer={layer} label={name} onChange={(l) => set({ layers: shadow.layers.map((m, j) => (j === i ? l : m)) })} />
              </fieldset>
            )
          })}
          <div className="flex gap-2 flex-wrap">
            <button type="button" className="qt-button qt-button-secondary qt-button-sm" onClick={() => set({ layers: [...shadow.layers, defaultShadowLayer()] })}>
              Add a layer<span className="sr-only"> to {props.label}</span>
            </button>
            {shadow.layers.length > 0 && (
              <button type="button" className="qt-button qt-button-ghost qt-button-sm" onClick={() => set({ layers: [] })}>
                No shadow<span className="sr-only"> for {props.label}</span>
              </button>
            )}
          </div>
        </div>
      )}
    />
  )
}

const SAMPLE_LINE = 'The butler, unflappable, set down the quill and tapped twice.'

/** An ordered list of families, chosen from the draft's fonts, the system stacks or typed in, with a sample. */
export function FontFamilyControl(props: ControlProps) {
  const resources = useContext(DraftResourcesContext)
  const addId = useId()
  return (
    <Typed<FontStack>
      props={props}
      parse={parseFontStack}
      format={formatFontStack}
      render={(stack, set) => {
        const families = stack.families
        const add = (more: readonly string[]) => set({ families: appendFamilies(families, more) })
        return (
          <div className="space-y-2">
            <ol className="space-y-1">
              {families.map((f, i) => (
                <li key={`${f}-${i}`} className="flex items-center gap-2 justify-between">
                  <span className="qt-text-xs font-mono break-all">
                    {i + 1}. {f}
                  </span>
                  <ItemButtons
                    label={`${f} in ${props.label}`}
                    index={i}
                    count={families.length}
                    canRemove={families.length > 1}
                    onMove={(by) => set({ families: moveItem(families, i, by) })}
                    onRemove={() => set({ families: families.filter((_, j) => j !== i) })}
                  />
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap gap-2 items-center">
              <label htmlFor={addId} className="qt-text-xs qt-text-secondary">
                Add
              </label>
              <select
                id={addId}
                className="qt-select qt-text-xs"
                value=""
                aria-label={`${props.label}, add a font`}
                onChange={(e) => {
                  const choice = e.target.value
                  if (choice.startsWith('font:')) add([choice.slice(5)])
                  else if (choice.startsWith('stack:')) add(SYSTEM_FONT_STACKS[Number(choice.slice(6))].families)
                }}
              >
                <option value="">Choose a font…</option>
                {resources.fonts.length > 0 && (
                  <optgroup label="This theme's fonts">
                    {resources.fonts.map((f) => (
                      <option key={f.family} value={`font:${f.family}`}>
                        {f.family}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Every system has these">
                  {SYSTEM_FONT_STACKS.map((s, i) => (
                    <option key={s.label} value={`stack:${i}`}>
                      {s.label}
                    </option>
                  ))}
                </optgroup>
              </select>
              <CommitText
                value=""
                label={`${props.label}, add a family by name`}
                placeholder="Or type a family"
                accept={(t) => parseFontStack(t) !== null}
                message={(t) => (parseFontStack(t) ? null : `“${t}” is not a family name the atelier can write. It will not be added.`)}
                onCommit={(t) => add(parseFontStack(t)!.families)}
              />
            </div>
            <p className="qt-text-small border qt-border-default rounded px-2 py-1" style={{ fontFamily: formatFontStack(stack) }}>
              {SAMPLE_LINE}
            </p>
          </div>
        )
      }}
    />
  )
}

const WEIGHT_NAMES: Readonly<Record<number, string>> = {
  100: 'Thin',
  200: 'Extra light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semibold',
  700: 'Bold',
  800: 'Extra bold',
  900: 'Black',
}

/** A select of the named and numeric weights, marking those the draft's font in force declares. */
export function FontWeightControl(props: ControlProps) {
  const resources = useContext(DraftResourcesContext)
  const declared = draftFontWeights(resources, props.familyInForce ?? null)
  return (
    <Typed<FontWeight>
      props={props}
      parse={parseFontWeight}
      format={formatFontWeight}
      render={(weight, set) => {
        const current = formatFontWeight(weight)
        const words: string[] = [...FONT_WEIGHT_KEYWORDS, ...Object.keys(WEIGHT_NAMES)]
        if (!words.includes(current)) words.push(current)
        const describe = (w: string) => {
          const n = weightNumber(w)
          const name = /^\d+$/.test(w) ? `${w} ${WEIGHT_NAMES[Number(w)] ?? ''}`.trim() : w
          return declared && n !== null && declared.includes(n) ? `${name} — the theme's font has it` : name
        }
        return (
          <div className="space-y-1">
            <WordSelect value={current} label={`${props.label} weight`} words={words} describe={describe} onChange={(w) => set(parseFontWeight(w)!)} />
            {declared && (
              <p className="qt-text-xs qt-text-secondary">
                The theme&rsquo;s “{props.familyInForce}” declares {declared.join(', ')}; others are imitated by the browser.
              </p>
            )}
          </div>
        )
      }}
    />
  )
}

/** A select of the words a keyword (or font style) may be. */
export function KeywordControl(props: ControlProps) {
  const words = props.options ?? []
  return (
    <Typed<string>
      props={props}
      parse={(v) => (words.includes(v.trim()) ? v.trim() : null)}
      format={(w) => w}
      render={(word, set) => <WordSelect value={word} label={`${props.label} choice`} words={words} onChange={set} />}
    />
  )
}

function QuantityFields({ q, label, onChange, units }: { q: Quantity; label: string; onChange: (q: Quantity) => void; units: readonly string[] }) {
  return (
    <span className="inline-flex items-center gap-1">
      <NumberField value={q.number} label={`${label}, amount`} min={0} onChange={(n) => onChange({ ...q, number: n })} />
      <WordSelect value={q.unit} label={`${label}, unit`} words={units} onChange={(unit) => onChange({ ...q, unit })} />
    </span>
  )
}

/** A number with ms or s. */
export function DurationControl(props: ControlProps) {
  return (
    <Typed<Quantity>
      props={props}
      parse={parseDuration}
      format={formatDuration}
      render={(q, set) => <QuantityFields q={q} label={props.label} units={DURATION_UNITS} onChange={set} />}
    />
  )
}

const NO_DELAY: Quantity = { number: 0, unit: 'ms' }

function TransitionLayerFields({ layer, label, onChange }: { layer: TransitionLayer; label: string; onChange: (l: TransitionLayer) => void }) {
  const easingList = useId()
  return (
    <div className="@container">
    <div className="grid gap-1 @sm:grid-cols-2">
      <label className="flex items-center gap-1 qt-text-xs qt-text-secondary">
        <span className="w-16 flex-shrink-0">Property</span>
        <CommitText
          value={layer.property}
          label={`${label}, property`}
          accept={(t) => /^-?[A-Za-z_][\w-]*$/.test(t)}
          message={(t) => (/^-?[A-Za-z_][\w-]*$/.test(t) ? null : `“${t}” is not a property name. It will not be applied.`)}
          onCommit={(property) => onChange({ ...layer, property })}
        />
      </label>
      <label className="flex items-center gap-1 qt-text-xs qt-text-secondary">
        <span className="w-16 flex-shrink-0">Duration</span>
        <QuantityFields q={layer.duration} label={`${label}, duration`} units={DURATION_UNITS} onChange={(duration) => onChange({ ...layer, duration })} />
      </label>
      <label className="flex items-center gap-1 qt-text-xs qt-text-secondary">
        <span className="w-16 flex-shrink-0">Easing</span>
        <CommitText
          value={layer.easing ?? 'ease'}
          label={`${label}, easing`}
          list={easingList}
          accept={isEasing}
          message={(t) => (isEasing(t) ? null : `“${t}” is not a timing function. It will not be applied.`)}
          onCommit={(easing) => onChange({ ...layer, easing })}
        />
        <datalist id={easingList}>
          {EASING_KEYWORDS.map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
      </label>
      <label className="flex items-center gap-1 qt-text-xs qt-text-secondary">
        <span className="w-16 flex-shrink-0">Delay</span>
        <QuantityFields
          q={layer.delay ?? NO_DELAY}
          label={`${label}, delay`}
          units={DURATION_UNITS}
          onChange={(delay) => {
            const { delay: _old, ...rest } = layer
            onChange(delay.number === 0 ? rest : { ...rest, delay })
          }}
        />
      </label>
    </div>
    </div>
  )
}

/** A list of transitions: property, duration, easing and delay. */
export function TransitionControl(props: ControlProps) {
  return (
    <Typed<Transition>
      props={props}
      parse={parseTransition}
      format={formatTransition}
      render={(t, set) => (
        <div className="space-y-2">
          {t.layers.length === 0 && <p className="qt-text-xs qt-text-muted">No transition: changes land at once.</p>}
          {t.layers.map((layer, i) => {
            const name = `${props.label}, transition ${i + 1}`
            return (
              <fieldset key={i} className="border qt-border-default rounded p-2">
                <legend className="qt-text-label-xs px-1 flex items-center gap-2">
                  Transition {i + 1}
                  <ItemButtons
                    label={name}
                    index={i}
                    count={t.layers.length}
                    onMove={(by) => set({ layers: moveItem(t.layers, i, by) })}
                    onRemove={() => set({ layers: t.layers.filter((_, j) => j !== i) })}
                  />
                </legend>
                <TransitionLayerFields layer={layer} label={name} onChange={(l) => set({ layers: t.layers.map((m, j) => (j === i ? l : m)) })} />
              </fieldset>
            )
          })}
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              className="qt-button qt-button-secondary qt-button-sm"
              onClick={() => set({ layers: [...t.layers, { property: 'all', duration: { number: 150, unit: 'ms' }, easing: 'ease' }] })}
            >
              Add a transition<span className="sr-only"> to {props.label}</span>
            </button>
            {t.layers.length > 0 && (
              <button type="button" className="qt-button qt-button-ghost qt-button-sm" onClick={() => set({ layers: [] })}>
                No transition<span className="sr-only"> for {props.label}</span>
              </button>
            )}
          </div>
        </div>
      )}
    />
  )
}

const OPACITY_UNITS = ['', '%'] as const

/** A number from 0 to 1, or a percent, with a slider beside it. */
export function OpacityControl(props: ControlProps) {
  return (
    <Typed<Quantity>
      props={props}
      parse={parseOpacity}
      format={formatOpacity}
      render={(q, set) => {
        const percent = q.unit === '%'
        const fraction = opacityFraction(q)
        const fromFraction = (f: number): Quantity => (percent ? { number: Math.round(f * 1000) / 10, unit: '%' } : { number: Math.round(f * 1000) / 1000, unit: '' })
        return (
          <span className="flex items-center gap-2 flex-wrap">
            <NumberField value={q.number} label={`${props.label}, amount`} min={0} max={percent ? 100 : 1} step={percent ? 1 : 0.01} onChange={(n) => set({ ...q, number: n })} />
            <WordSelect
              value={q.unit}
              label={`${props.label}, written as`}
              words={OPACITY_UNITS}
              describe={(u) => (u === '%' ? 'percent' : 'fraction of 1')}
              onChange={(unit) => set(unit === '%' ? { number: Math.round(fraction * 1000) / 10, unit } : { number: Math.round(fraction * 1000) / 1000, unit })}
            />
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(fraction * 100)}
              aria-label={`${props.label}, slider`}
              className="flex-1 min-w-24"
              onChange={(e) => set(fromFraction(Number(e.target.value) / 100))}
            />
          </span>
        )
      }}
    />
  )
}

const DEFAULT_BLUR: LengthPart = { kind: 'number', number: 8, unit: 'px' }

/** `none`, or a length inside `blur()`. */
export function BlurControl(props: ControlProps) {
  return (
    <Typed<Blur>
      props={props}
      parse={parseBlur}
      format={formatBlur}
      render={(blur, set) => (
        <span className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-1 qt-text-xs qt-text-secondary">
            <input
              type="checkbox"
              checked={blur.kind === 'none'}
              onChange={(e) => set(e.target.checked ? { kind: 'none' } : { kind: 'blur', length: DEFAULT_BLUR })}
            />
            No blur<span className="sr-only"> for {props.label}</span>
          </label>
          {blur.kind === 'blur' && (
            <LengthPartField part={blur.length} label={`${props.label} blur`} keywords={false} min={0} onChange={(length) => set({ kind: 'blur', length })} />
          )}
        </span>
      )}
    />
  )
}

/** `none` or one of the draft's images, with a thumbnail. */
export function ImageControl(props: ControlProps) {
  const resources = useContext(DraftResourcesContext)
  return (
    <Typed<ImageValue>
      props={props}
      parse={parseImage}
      format={formatImage}
      render={(image, set) => {
        const current = image.kind === 'none' ? '' : image.path
        const known = resources.images.find((i) => i.path === current)
        return (
          <div className="flex items-center gap-2 flex-wrap">
            <select
              className="qt-select qt-text-xs"
              value={current}
              aria-label={`${props.label} image`}
              onChange={(e) => set(e.target.value === '' ? { kind: 'none' } : { kind: 'file', path: e.target.value })}
            >
              <option value="">None</option>
              {resources.images.map((i) => (
                <option key={i.path} value={i.path}>
                  {i.path}
                </option>
              ))}
              {current !== '' && !known && <option value={current}>{current} (not in this draft)</option>}
            </select>
            {known?.url ? (
              <img src={known.url} alt={`Thumbnail of ${known.path}`} className="h-10 w-16 object-cover rounded border qt-border-default" />
            ) : (
              resources.images.length === 0 && <span className="qt-text-xs qt-text-muted">This draft holds no images yet.</span>
            )}
          </div>
        )
      }}
    />
  )
}

/** An integer, or `auto`. */
export function ZIndexControl(props: ControlProps) {
  return (
    <Typed
      props={props}
      parse={parseZIndex}
      format={formatZIndex}
      render={(z, set) => (
        <span className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-1 qt-text-xs qt-text-secondary">
            <input type="checkbox" checked={z.kind === 'auto'} onChange={(e) => set(e.target.checked ? { kind: 'auto' } : { kind: 'number', number: 0 })} />
            Auto<span className="sr-only"> for {props.label}</span>
          </label>
          {z.kind === 'number' && (
            <NumberField value={z.number} label={`${props.label}, layer`} integer step={1} onChange={(number) => set({ kind: 'number', number })} />
          )}
        </span>
      )}
    />
  )
}

/** A plain number (a primitive of type number). */
export function NumberControl(props: ControlProps) {
  return (
    <Typed<number>
      props={props}
      parse={(v) => (/^-?(\d+\.?\d*|\.\d+)$/.test(v.trim()) ? Number(v.trim()) : null)}
      format={formatNumber}
      render={(n, set) => <NumberField value={n} label={`${props.label}, number`} onChange={set} />}
    />
  )
}

/** A timing function (a primitive of type easing), with the keywords offered. */
export function EasingControl(props: ControlProps) {
  const list = useId()
  return (
    <>
      <CommitText
        value={props.value}
        label={`${props.label} value`}
        list={list}
        accept={isEasing}
        message={(t) => (isEasing(t) ? null : `“${t}” is not a timing function. It will not be applied.`)}
        onCommit={props.onCommit}
      />
      <datalist id={list}>
        {EASING_KEYWORDS.map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>
    </>
  )
}

const CONTROLS: Partial<Record<TokenType, (props: ControlProps) => ReactNode>> = {
  color: (props) => <ColorControl {...props} />,
  length: (props) => <LengthControl {...props} />,
  radius: (props) => <LengthControl {...props} />,
  shadow: (props) => <ShadowControl {...props} />,
  'font-family': (props) => <FontFamilyControl {...props} />,
  'font-weight': (props) => <FontWeightControl {...props} />,
  'font-style': (props) => <KeywordControl {...props} />,
  keyword: (props) => (props.options ? <KeywordControl {...props} /> : <TextControl {...props} />),
  duration: (props) => <DurationControl {...props} />,
  transition: (props) => <TransitionControl {...props} />,
  opacity: (props) => <OpacityControl {...props} />,
  blur: (props) => <BlurControl {...props} />,
  image: (props) => <ImageControl {...props} />,
  'z-index': (props) => <ZIndexControl {...props} />,
  number: (props) => <NumberControl {...props} />,
  easing: (props) => <EasingControl {...props} />,
}

/** The control for the value's type: its own where it has one, the text control otherwise (raw, border). */
export function ValueControl(props: ControlProps) {
  return CONTROLS[props.type]?.(props) ?? <TextControl {...props} />
}
