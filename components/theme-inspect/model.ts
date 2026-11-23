/**
 * Calliope's inspector — the model (Calliope Live, Spec H, Stage 0).
 *
 * Pure and client-safe. Three questions, each answered from plain data so
 * they test without a browser (`./dom.ts` is the only part that reads the
 * page):
 *
 *  1. **Element to hook** (decision 4). From the class lists and attributes
 *     of an element and its ancestors, the nearest catalogued hook, the
 *     variant values and states present on it, and the selectors from
 *     `hookSelectors` that match what is present.
 *  2. **Rules to properties** (decision 3). From the rules that match an
 *     element, the custom properties each CSS property uses, in cascade
 *     order, with the rules that would apply on hover, focus or press kept
 *     apart and labelled (decision 8), and the theme's own custom CSS marked.
 *  3. **Property to token.** A custom property followed through the
 *     resolved theme to the token an author would change: what it follows,
 *     the value in force in the mode, and whether this theme sets it.
 *
 * @module components/theme-inspect/model
 */

import { HOOKS, type HookDef, type HookState } from '@/lib/themes/hooks'
import { THEME_TOKENS, type ResolvedTheme, type TokenDef } from '@/lib/themes/engine/client'
import { tailwindAlias } from '@/lib/themes/registry/tailwind'
import { hookSelectors, type HookSelector } from '@/components/theme-editor/assets/styles-model'
import { rowModeView, type EditorMode, type RowSource } from '@/components/theme-editor/model'

// ---------------------------------------------------------------------------
// 1. Element to hook

/** What the inspector may know of an element: its classes and attributes. Never its text. */
export interface ElementFacts {
  classes: readonly string[]
  attributes: Readonly<Record<string, string>>
}

export interface PresentVariant {
  attribute: string
  value: string
  /** False when the set is closed and this value is not one of its values. */
  known: boolean
}

export interface HookMatch {
  hook: HookDef
  /** 0 when the element itself carries the hook; otherwise how many ancestors up. */
  depth: number
  /** Other catalogued hooks on the same element, in catalogue order. */
  alsoOn: HookDef[]
  variants: PresentVariant[]
  states: HookState[]
  /** Every selector from `hookSelectors` that matches what is present, the class alone first. */
  selectors: HookSelector[]
  /** The most specific of them: a state, else a variant, else the class. */
  selector: HookSelector
}

const HOOK_BY_CLASS: ReadonlyMap<string, HookDef> = new Map(HOOKS.map((h) => [h.className, h]))

/** The catalogued hook a class names, or undefined. */
export const hookByClass = (className: string): HookDef | undefined => HOOK_BY_CLASS.get(className)
const HOOK_ORDER: ReadonlyMap<string, number> = new Map(HOOKS.map((h, i) => [h.className, i]))

/** The catalogued hooks an element carries, in catalogue order. */
export function hooksOn(facts: ElementFacts): HookDef[] {
  return facts.classes
    .map((c) => HOOK_BY_CLASS.get(c))
    .filter((h): h is HookDef => h !== undefined)
    .sort((a, b) => (HOOK_ORDER.get(a.className) ?? 0) - (HOOK_ORDER.get(b.className) ?? 0))
}

function statePresent(state: HookState, facts: ElementFacts): boolean {
  if (state.kind === 'class') return facts.classes.includes(state.className)
  const value = facts.attributes[state.attribute]
  return value !== undefined && state.values.includes(value)
}

/** The hook, variants and states of one element that carries `hook`. */
export function describeHook(hook: HookDef, facts: ElementFacts, depth = 0, alsoOn: HookDef[] = []): HookMatch {
  const variants: PresentVariant[] = []
  for (const v of hook.variants ?? []) {
    const value = facts.attributes[v.attribute]
    if (value === undefined) continue
    variants.push({ attribute: v.attribute, value, known: v.values === 'open' || v.values.includes(value) })
  }
  const states = (hook.states ?? []).filter((s) => statePresent(s, facts))

  const base = `.${hook.className}`
  const wanted = new Set<string>([base])
  for (const v of variants) {
    const def = hook.variants?.find((d) => d.attribute === v.attribute)
    if (def?.values === 'open') wanted.add(`${base}[${v.attribute}]`)
    else if (v.known) wanted.add(`${base}[${v.attribute}="${v.value}"]`)
  }
  for (const s of states) {
    if (s.kind === 'class') wanted.add(`${base}.${s.className}`)
    else wanted.add(`${base}[${s.attribute}="${facts.attributes[s.attribute]}"]`)
  }
  const selectors = hookSelectors(hook).filter((s) => wanted.has(s.selector))
  return { hook, depth, alsoOn, variants, states, selectors, selector: selectors[selectors.length - 1] }
}

/**
 * The nearest catalogued hook at or above an element (decision 4). `chain`
 * is the element first, then its ancestors outward. Null when nothing in
 * the chain carries one.
 */
export function hookForChain(chain: readonly ElementFacts[]): HookMatch | null {
  for (let depth = 0; depth < chain.length; depth++) {
    const hooks = hooksOn(chain[depth])
    if (hooks.length > 0) return describeHook(hooks[0], chain[depth], depth, hooks.slice(1))
  }
  return null
}

// ---------------------------------------------------------------------------
// 2. Rules to properties — parsing helpers

/** Split `text` at top-level occurrences of `sep`, outside brackets, parentheses and quotes. */
function splitTopLevel(text: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote: string | null = null
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1)
    else if (ch === sep && depth === 0) {
      out.push(text.slice(start, i))
      start = i + 1
    }
  }
  out.push(text.slice(start))
  return out
}

/** A selector list's selectors, trimmed. */
export function splitSelectorList(selectorText: string): string[] {
  return splitTopLevel(selectorText, ',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export interface Declaration {
  property: string
  value: string
  important: boolean
}

/** A declaration block's text (`rule.style.cssText`, which keeps shorthands written with `var()`) as declarations. */
export function parseDeclarations(cssText: string): Declaration[] {
  const out: Declaration[] = []
  for (const part of splitTopLevel(cssText, ';')) {
    const colon = part.indexOf(':')
    if (colon < 0) continue
    const property = part.slice(0, colon).trim()
    let value = part.slice(colon + 1).trim()
    if (!property || !value) continue
    const important = /!\s*important\s*$/i.test(value)
    if (important) value = value.replace(/!\s*important\s*$/i, '').trim()
    out.push({ property: property.startsWith('--') ? property : property.toLowerCase(), value, important })
  }
  return out
}

/** The custom properties a value reads, fallbacks included, in order of appearance. */
export function varsIn(value: string): string[] {
  const out: string[] = []
  for (const m of value.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) if (!out.includes(m[1])) out.push(m[1])
  return out
}

export type Specificity = readonly [number, number, number]

const ZERO: Specificity = [0, 0, 0]
const add = (a: Specificity, b: Specificity): Specificity => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const compareSpecificity = (a: Specificity, b: Specificity) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
const maxOf = (list: Specificity[]) => list.reduce((m, s) => (compareSpecificity(s, m) > 0 ? s : m), ZERO)

const LEGACY_PSEUDO_ELEMENTS = new Set(['before', 'after', 'first-line', 'first-letter'])

/** The text inside the parentheses that open at `open`, and the index after the closing one. */
function readParens(text: string, open: number): { inner: string; end: number } {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') {
      depth--
      if (depth === 0) return { inner: text.slice(open + 1, i), end: i + 1 }
    }
  }
  return { inner: text.slice(open + 1), end: text.length }
}

/** Selectors Level 4 specificity of one complex selector (not a list). */
export function specificity(selector: string): Specificity {
  let s: Specificity = ZERO
  const text = selector.trim()
  let i = 0
  const ident = (from: number) => {
    let j = from
    while (j < text.length && /[A-Za-z0-9_\-\\ -￿]/.test(text[j])) j += text[j] === '\\' ? 2 : 1
    return j
  }
  while (i < text.length) {
    const ch = text[i]
    if (ch === '#') {
      s = add(s, [1, 0, 0])
      i = ident(i + 1)
    } else if (ch === '.') {
      s = add(s, [0, 1, 0])
      i = ident(i + 1)
    } else if (ch === '[') {
      s = add(s, [0, 1, 0])
      let depth = 0
      let quote: string | null = null
      for (; i < text.length; i++) {
        const c = text[i]
        if (quote) {
          if (c === '\\') i++
          else if (c === quote) quote = null
        } else if (c === '"' || c === "'") quote = c
        else if (c === '[') depth++
        else if (c === ']' && --depth === 0) break
      }
      i++
    } else if (ch === ':') {
      const element = text[i + 1] === ':'
      const nameStart = i + (element ? 2 : 1)
      const nameEnd = ident(nameStart)
      const name = text.slice(nameStart, nameEnd).toLowerCase()
      let args: string | null = null
      i = nameEnd
      if (text[i] === '(') {
        const p = readParens(text, i)
        args = p.inner
        i = p.end
      }
      if (element || LEGACY_PSEUDO_ELEMENTS.has(name)) s = add(s, [0, 0, 1])
      else if (name === 'where') s = add(s, ZERO)
      else if (name === 'is' || name === 'not' || name === 'has' || name === 'matches') {
        s = add(s, maxOf(splitSelectorList(args ?? '').map(specificity)))
      } else if ((name === 'nth-child' || name === 'nth-last-child') && args && /\sof\s/i.test(args)) {
        s = add(add(s, [0, 1, 0]), maxOf(splitSelectorList(args.split(/\sof\s/i)[1]).map(specificity)))
      } else s = add(s, [0, 1, 0])
    } else if (ch === '*' || ch === '&' || /[\s>+~|]/.test(ch) || ch === ')' || ch === ',') {
      i++
    } else if (/[A-Za-z_\\ -￿-]/.test(ch)) {
      s = add(s, [0, 0, 1])
      i = ident(i)
    } else i++
  }
  return s
}

/** States a rule may be waiting on (decision 8). */
export type InteractionState = 'hover' | 'focus' | 'active'

const INTERACTION_PSEUDOS: ReadonlyArray<[RegExp, InteractionState]> = [
  [/:hover(?![\w-])/g, 'hover'],
  [/:focus-visible(?![\w-])/g, 'focus'],
  [/:focus-within(?![\w-])/g, 'focus'],
  [/:focus(?![\w-])/g, 'focus'],
  [/:active(?![\w-])/g, 'active'],
]

/**
 * The selector with `:hover`, `:focus`, `:focus-visible`, `:focus-within`
 * and `:active` taken out, and the states they asked for; null when it
 * names none. A compound left empty by the removal becomes `*`.
 */
export function stripInteraction(selector: string): { selector: string; states: InteractionState[] } | null {
  let out = selector
  const states: InteractionState[] = []
  for (const [re, state] of INTERACTION_PSEUDOS) {
    out = out.replace(re, (_match, offset: number, whole: string) => {
      if (!states.includes(state)) states.push(state)
      // Inside a compound the pseudo-class simply goes; standing alone it leaves `*`.
      const before = offset > 0 ? whole[offset - 1] : ''
      const after = whole[offset + _match.length] ?? ''
      const startsCompound = before === '' || /[\s>+~(,]/.test(before)
      const endsCompound = after === '' || /[\s>+~),]/.test(after)
      return startsCompound && endsCompound ? '*' : ''
    })
  }
  if (states.length === 0) return null
  return { selector: out.trim() || '*', states }
}

// ---------------------------------------------------------------------------
// 2. Rules to properties — the cascade

/**
 * Where a rule came from: the app's own stylesheets, or the theme's style
 * element — its token block, its icon overrides, or its custom CSS (the
 * author's own rules). `inline` is the element's own `style` attribute,
 * which outranks every rule's normal declarations.
 */
export type RuleOrigin = 'app' | 'inline' | 'theme-tokens' | 'theme-icons' | 'theme-custom'

/** A rule that matches the element (as `./dom.ts` finds it). */
export interface MatchedRule {
  /** The selector of the list that matched (or would, in `state`). */
  selector: string
  declarations: readonly Declaration[]
  origin: RuleOrigin
  /** The cascade layer's full name, or null when unlayered. */
  layer: string | null
  /** Document order across every stylesheet read. */
  order: number
  /** The interaction the rule waits on, or null when it applies now. */
  state: InteractionState | null
  /** Where the stylesheet came from, for display. */
  source: string
}

export interface PropertyUse {
  value: string
  important: boolean
  /** The custom properties the value reads. */
  vars: string[]
  rule: MatchedRule
}

export interface PropertyReport {
  property: string
  /** Every declaration of the property, highest precedence first; the first is in force. */
  uses: PropertyUse[]
  /**
   * The custom properties the declaration in force reads, followed through
   * custom properties the same rules declare on the element (so
   * `background: var(--_bg)` with `--_bg: var(--qt-card-bg)` gives both).
   */
  vars: string[]
  /** True when the declaration in force is from the theme's own custom CSS. */
  fromCustomCss: boolean
}

export interface InspectedProperties {
  /** What applies now. */
  base: PropertyReport[]
  /** For each state, the properties a rule waiting on it would win. */
  states: Partial<Record<InteractionState, PropertyReport[]>>
}

/** Rank of a layer in the cascade: unlayered normal declarations beat every layer; important ones lose to every layer. */
function layerRank(layer: string | null, important: boolean, layerOrder: readonly string[]): number {
  const n = layerOrder.length
  if (layer === null) return important ? -1 : n
  const i = layerOrder.indexOf(layer)
  const index = i < 0 ? n - 1 : i
  return important ? n - index : index
}

function compareUses(a: PropertyUse & { spec: Specificity }, b: PropertyUse & { spec: Specificity }, layerOrder: readonly string[]): number {
  if (a.important !== b.important) return a.important ? -1 : 1
  const ia = a.rule.origin === 'inline'
  const ib = b.rule.origin === 'inline'
  if (ia !== ib) return ia ? -1 : 1
  const la = layerRank(a.rule.layer, a.important, layerOrder)
  const lb = layerRank(b.rule.layer, b.important, layerOrder)
  if (la !== lb) return lb - la
  const sp = compareSpecificity(b.spec, a.spec)
  if (sp !== 0) return sp
  return b.rule.order - a.rule.order
}

function reportsFor(rules: readonly MatchedRule[], layerOrder: readonly string[]): PropertyReport[] {
  const byProperty = new Map<string, Array<PropertyUse & { spec: Specificity }>>()
  for (const rule of rules) {
    const spec = specificity(rule.selector)
    for (const d of rule.declarations) {
      const list = byProperty.get(d.property) ?? []
      list.push({ value: d.value, important: d.important, vars: varsIn(d.value), rule, spec })
      byProperty.set(d.property, list)
    }
  }
  const winners = new Map<string, PropertyUse>()
  const reports: PropertyReport[] = []
  for (const [property, list] of byProperty) {
    list.sort((a, b) => compareUses(a, b, layerOrder))
    const uses = list.map(({ spec: _spec, ...use }) => use)
    winners.set(property, uses[0])
    reports.push({ property, uses, vars: [], fromCustomCss: uses[0].rule.origin === 'theme-custom' })
  }
  const expand = (vars: readonly string[], seen: Set<string>): string[] => {
    const out: string[] = []
    for (const v of vars) {
      if (seen.has(v)) continue
      seen.add(v)
      out.push(v)
      const local = winners.get(v)
      if (local) out.push(...expand(local.vars, seen))
    }
    return out
  }
  for (const r of reports) r.vars = expand(r.uses[0].vars, new Set([r.property]))
  return reports.sort((a, b) => a.property.localeCompare(b.property))
}

/**
 * The custom properties each CSS property of an element uses, in cascade
 * order (decision 3). `layerOrder` is every cascade layer's full name in
 * the order the page declares them. Rules waiting on an interaction are
 * reported apart, each state with the properties it would change.
 */
export function inspectProperties(rules: readonly MatchedRule[], layerOrder: readonly string[] = []): InspectedProperties {
  const now = rules.filter((r) => r.state === null)
  const base = reportsFor(now, layerOrder)
  const states: InspectedProperties['states'] = {}
  for (const state of ['hover', 'focus', 'active'] as const) {
    const waiting = rules.filter((r) => r.state === state)
    if (waiting.length === 0) continue
    const changed = reportsFor([...now, ...waiting], layerOrder).filter((r) => r.uses[0].rule.state === state)
    if (changed.length > 0) states[state] = changed
  }
  return { base, states }
}

/** What a CSS property sets, for grouping in the panel. */
export type PropertyCategory = 'background' | 'text' | 'border' | 'shadow' | 'radius' | 'spacing' | 'type' | 'variable' | 'other'

export function propertyCategory(property: string): PropertyCategory {
  const p = property.toLowerCase()
  if (p.startsWith('--')) return 'variable'
  if (p.includes('radius')) return 'radius'
  if (p.startsWith('background')) return 'background'
  if (p === 'color' || p === 'fill' || p === 'stroke' || p === 'caret-color' || p === 'accent-color' || p === 'text-decoration-color') return 'text'
  if (p.startsWith('border') || p.startsWith('outline')) return 'border'
  if (p.endsWith('shadow')) return 'shadow'
  if (/^(margin|padding|gap|row-gap|column-gap|inset|top|right|bottom|left)(-|$)/.test(p)) return 'spacing'
  if (p.startsWith('font') || p === 'line-height' || p === 'letter-spacing' || p.startsWith('text-') || p === 'word-spacing') return 'type'
  return 'other'
}

// ---------------------------------------------------------------------------
// 3. Property to token

const TOKENS_BY_NAME: ReadonlyMap<string, TokenDef> = new Map(THEME_TOKENS.map((t) => [t.name, t]))

export interface TokenStep {
  name: string
  label: string
}

export interface TokenTrace {
  /** The property as the rule wrote it. */
  property: string
  /** The registry token or primitive it is, after a Tailwind name is read as the token it stands for. */
  name: string
  kind: 'token' | 'primitive' | 'unknown'
  token: TokenDef | null
  /** The value as written in the mode; empty for an unknown property or an unset optional token. */
  value: string
  /** The value it comes down to (a colour, a length), or null. */
  literal: string | null
  source: RowSource | null
  /** True when this theme sets the value itself. */
  setByTheme: boolean
  /** What it follows, step by step, nearest first. */
  follows: TokenStep[]
}

const MAX_FOLLOW = 12

/**
 * Follow a custom property through the resolved theme: a Tailwind name
 * (`--color-primary`) is read as the semantic token it stands for, a
 * registry token or primitive gives its value, source and what it follows,
 * and anything else is shown by name only.
 */
export function traceProperty(property: string, resolved: ResolvedTheme, mode: EditorMode): TokenTrace {
  const alias = tailwindAlias(property)
  const name = alias && TOKENS_BY_NAME.has(alias) ? alias : property
  const token = TOKENS_BY_NAME.get(name) ?? null
  const isPrimitive = name.startsWith('--p-') && resolved[mode][name] !== undefined
  if (!token && !isPrimitive) {
    return { property, name, kind: 'unknown', token: null, value: '', literal: null, source: null, setByTheme: false, follows: [] }
  }
  const view = rowModeView(resolved, name, mode)
  const follows: TokenStep[] = []
  const seen = new Set([name])
  let step: TokenStep | null = view.follows
  while (step && follows.length < MAX_FOLLOW && !seen.has(step.name)) {
    seen.add(step.name)
    // A default written against a Tailwind name (`var(--color-card)`) follows the token that name stands for.
    const stepAlias = resolved[mode][step.name] ? undefined : tailwindAlias(step.name)
    const at: TokenStep = stepAlias && TOKENS_BY_NAME.has(stepAlias) ? { name: stepAlias, label: TOKENS_BY_NAME.get(stepAlias)!.label } : step
    follows.push(at)
    seen.add(at.name)
    step = resolved[mode][at.name] ? rowModeView(resolved, at.name, mode).follows : null
  }
  return {
    property,
    name,
    kind: token ? 'token' : 'primitive',
    token,
    value: view.value,
    literal: view.literal,
    source: view.source,
    setByTheme: view.source.kind === 'theme',
    follows,
  }
}

// ---------------------------------------------------------------------------
// 4. What the panel shows

export const CATEGORY_ORDER: readonly PropertyCategory[] = ['background', 'text', 'border', 'shadow', 'radius', 'spacing', 'type', 'other']

export const CATEGORY_LABELS: Record<PropertyCategory, string> = {
  background: 'Background',
  text: 'Text colour',
  border: 'Border and outline',
  shadow: 'Shadow',
  radius: 'Corners',
  spacing: 'Spacing',
  type: 'Type',
  variable: 'Variables',
  other: 'Other',
}

/** Plumbing the panel leaves out: Tailwind's own variables and private locals (already followed through). */
const isPlumbing = (name: string) => name.startsWith('--tw-') || name.startsWith('--_')

export interface TokenUse {
  property: string
  /** The declaration in force, as written. */
  declared: string
  /** The custom properties it reads, traced; plumbing left out. */
  traces: TokenTrace[]
  fromCustomCss: boolean
}

export interface CategoryGroup {
  category: PropertyCategory
  label: string
  uses: TokenUse[]
}

/**
 * The properties that read a custom property (or come from the theme's own
 * CSS), grouped by what they set, in the panel's order. Declarations of
 * custom properties themselves are not listed: what they feed is.
 */
export function groupTokenUses(reports: readonly PropertyReport[], trace: (name: string) => TokenTrace): CategoryGroup[] {
  const groups = new Map<PropertyCategory, TokenUse[]>()
  for (const report of reports) {
    const category = propertyCategory(report.property)
    if (category === 'variable') continue
    const traces = report.vars.filter((v) => !isPlumbing(v)).map(trace)
    if (traces.length === 0 && !report.fromCustomCss) continue
    const list = groups.get(category) ?? []
    list.push({ property: report.property, declared: report.uses[0].value, traces, fromCustomCss: report.fromCustomCss })
    groups.set(category, list)
  }
  return CATEGORY_ORDER.filter((c) => groups.has(c)).map((c) => ({ category: c, label: CATEGORY_LABELS[c], uses: groups.get(c)! }))
}

/** A compiled custom rule's selector as its author wrote it: the scoping the compiler adds (`:scope `) taken off. */
export const authoredSelector = (selector: string): string => selector.replace(/^:scope\s+/, '')

/** The theme's own rules among those that match, each once, in document order, their selectors as authored. */
export function customCssRules(rules: readonly MatchedRule[]): MatchedRule[] {
  const seen = new Set<string>()
  const out: MatchedRule[] = []
  for (const r of [...rules].sort((a, b) => a.order - b.order)) {
    if (r.origin !== 'theme-custom') continue
    const selector = authoredSelector(r.selector)
    const key = `${selector}|${r.state ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ...r, selector })
  }
  return out
}
