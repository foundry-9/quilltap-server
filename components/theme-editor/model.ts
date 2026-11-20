/**
 * Calliope's Atelier — the theme editor's pure model.
 *
 * Everything the editor computes from a draft lives here, over the browser
 * entry of the theme engine (`lib/themes/engine/client.ts`) and nothing else:
 * the levels and sections (Spec E decision 1) and the search over them, the
 * preview CSS (the server's compiled font faces, icons and custom CSS around
 * the tokens the editor emits, in injector order), what a row shows (value
 * in force, where it comes from, what it follows, the type check, the
 * contrast of each pair it is in), every edit (set a mode, reset, a dark
 * value apart or joined, follow a primitive or let it go, pick a choice) as
 * a function from a tokens document to a tokens document, and the undo
 * history. No React, no fetch.
 *
 * @module components/theme-editor/model
 */

import {
  CLIENT_REGISTRY_VIEW,
  CONTRAST_PAIRS,
  THEME_CHOICES,
  TOKEN_GROUPS,
  THEME_TOKENS,
  checkContrast,
  deriveThemeFeatures,
  emitThemeCss,
  parseColor,
  parseFontStack,
  parseTransition,
  primitiveUsers,
  primitiveVar,
  resolveLiteral,
  resolveTheme,
  tokenModes,
  typeProblem,
  type ContrastFinding,
  type ResolvedTheme,
  type ThemePrimitive,
  type ThemeTokensDocument,
  type TokenDef,
  type TokenType,
} from '@/lib/themes/engine/client'
import type { ThemePreview } from '@/components/providers/theme/types'

export type EditorMode = 'light' | 'dark'

/**
 * The editor's levels (Spec E decision 1). Essentials are the semantic,
 * standard tokens; Components the component, standard ones, with the
 * advanced tokens behind a disclosure in each section. Internal tokens are
 * never shown.
 */
export type EditorLevel = 'essentials' | 'components'

/** Where a token sits in the editor, or null for an internal one. */
export function placeOf(token: TokenDef): 'essential' | 'component' | 'advanced' | null {
  if (token.visibility === 'internal') return null
  if (token.visibility === 'advanced') return 'advanced'
  return token.tier === 'semantic' ? 'essential' : 'component'
}

/** One registry group as the editor holds it: its tokens at each place, in registry order. */
export interface EditorGroup {
  id: string
  label: string
  description?: string
  essential: readonly TokenDef[]
  component: readonly TokenDef[]
  advanced: readonly TokenDef[]
}

/** Every registry group with a token an author may set, in registry order. */
export const EDITOR_GROUPS: readonly EditorGroup[] = TOKEN_GROUPS.map((group) => ({
  id: group.id,
  label: group.label,
  description: group.description,
  essential: group.tokens.filter((t) => placeOf(t) === 'essential'),
  component: group.tokens.filter((t) => placeOf(t) === 'component'),
  advanced: group.tokens.filter((t) => placeOf(t) === 'advanced'),
})).filter((g) => g.essential.length + g.component.length + g.advanced.length > 0)

/** What narrows the rows: a search and the "changed only" filter. */
export interface EditorFilter {
  query: string
  changedOnly: boolean
}

/** A section as the editor draws it. */
export interface SectionView {
  id: string
  label: string
  description?: string
  /** The rows shown in the section itself. */
  rows: readonly TokenDef[]
  /** The rows behind the section's advanced disclosure. */
  advanced: readonly TokenDef[]
  /** How many of the group's tokens, at any level, the theme sets. */
  changed: number
  /**
   * A search or the changed-only filter is narrowing the rows: the section
   * and its advanced disclosure are shown open, whatever the author left them.
   */
  forced: boolean
}

/** Whether `token` answers `query` (label, name or description, ignoring case). */
export function matchesQuery(token: TokenDef, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    token.label.toLowerCase().includes(q) ||
    token.name.toLowerCase().includes(q) ||
    (token.description?.toLowerCase().includes(q) ?? false)
  )
}

/** Whether a filter is narrowing anything. */
export function isFiltering(filter: EditorFilter): boolean {
  return filter.query.trim() !== '' || filter.changedOnly
}

/**
 * The sections for `level` under `filter`. Unfiltered, a level shows its own
 * rows (Essentials: no advanced; Components: the advanced behind the
 * disclosure) and a group with nothing at that level is left out. A search
 * or the changed-only filter looks across every level, so a match is found
 * wherever it lives: the section's rows are the matching essentials and
 * components, its advanced the matching advanced, and a section with no
 * match is left out.
 */
export function sectionViews(level: EditorLevel, filter: EditorFilter, tokens: ThemeTokensDocument): SectionView[] {
  const filtering = isFiltering(filter)
  const keep = (t: TokenDef) => matchesQuery(t, filter.query) && (!filter.changedOnly || isOverridden(tokens, t.name))
  const views: SectionView[] = []
  for (const group of EDITOR_GROUPS) {
    const changed = [...group.essential, ...group.component, ...group.advanced].filter((t) => isOverridden(tokens, t.name)).length
    let rows: readonly TokenDef[]
    let advanced: readonly TokenDef[]
    if (filtering) {
      rows = [...group.essential, ...group.component].filter(keep)
      advanced = group.advanced.filter(keep)
    } else if (level === 'essentials') {
      rows = group.essential
      advanced = []
    } else {
      rows = group.component
      advanced = group.advanced
    }
    if (rows.length + advanced.length === 0) continue
    views.push({ id: group.id, label: group.label, description: group.description, rows, advanced, changed, forced: filtering })
  }
  return views
}

const TOKENS_BY_NAME: ReadonlyMap<string, TokenDef> = new Map(THEME_TOKENS.map((t) => [t.name, t]))

/** Where a registry token's row lives: the level that shows it, its section, and whether it sits behind the advanced disclosure. */
export interface TokenLocation {
  level: EditorLevel
  sectionId: string
  advanced: boolean
}

/**
 * Where `name`'s row is, or null for a name with no row (not a registry
 * token, or an internal one). An essential shows at the essentials level;
 * a component or advanced token only at the components level.
 */
export function tokenLocation(name: string): TokenLocation | null {
  for (const group of EDITOR_GROUPS) {
    if (group.essential.some((t) => t.name === name)) return { level: 'essentials', sectionId: group.id, advanced: false }
    if (group.component.some((t) => t.name === name)) return { level: 'components', sectionId: group.id, advanced: false }
    if (group.advanced.some((t) => t.name === name)) return { level: 'components', sectionId: group.id, advanced: true }
  }
  return null
}

/** The DOM id of a token's row: stable, from the token's name. */
export function tokenRowDomId(name: string): string {
  return `qt-token-row-${name.replace(/^-+/, '').replace(/[^A-Za-z0-9_-]/g, '_')}`
}

/** The registry's plain-English label for a token or primitive name. */
export function labelFor(name: string): string {
  const token = TOKENS_BY_NAME.get(name)
  if (token) return token.label
  if (name.startsWith('--p-')) return `primitive “${name.slice(4)}”`
  return name
}

/** The draft parts the server compiles (the editor cannot change them yet). */
export interface CompiledParts {
  fontFaces: string
  icons: string
  custom: string
}

/** What the preview needs from a draft besides its tokens. */
export interface PreviewSource {
  id: string
  version: string | null
  compiled: CompiledParts
  subsystems: ThemePreview['subsystems']
}

/**
 * The preview for `tokens`: the tokens CSS emitted here, joined with the
 * server's compiled pieces in injector order (font faces, tokens, icons,
 * custom) exactly as the server joins an installed theme's.
 */
export function buildPreview(source: PreviewSource, tokens: ThemeTokensDocument): ThemePreview {
  const resolved = resolveTheme(tokens, CLIENT_REGISTRY_VIEW)
  const tokensCss = emitThemeCss(tokens, { id: source.id, version: source.version ?? '0.0.0' })
  const css = [source.compiled.fontFaces, tokensCss, source.compiled.icons, source.compiled.custom]
    .filter((s) => s.trim())
    .join('\n\n')
  return {
    themeId: source.id,
    css,
    features: deriveThemeFeatures(resolved, tokens),
    choices: resolved.choices,
    subsystems: source.subsystems && Object.keys(source.subsystems).length > 0 ? source.subsystems : null,
  }
}

/** The resolved theme and every contrast finding for `tokens`. */
export function analyse(tokens: ThemeTokensDocument): { resolved: ResolvedTheme; findings: ContrastFinding[] } {
  const resolved = resolveTheme(tokens, CLIENT_REGISTRY_VIEW)
  return { resolved, findings: checkContrast(resolved, CONTRAST_PAIRS) }
}

/** Where a row's value in force comes from. */
export type RowSource =
  | { kind: 'default' }
  | { kind: 'choice'; choice: string; choiceLabel: string; option: string }
  | { kind: 'theme' }
  /** An optional token the theme leaves unset: each place keeps what it did before. */
  | { kind: 'unset' }

/** What one row shows for one mode. */
export interface RowModeView {
  /** The value as written (may be a `var()`); empty for an unset optional token. */
  value: string
  /** The value with every reference substituted, or null when it does not resolve. */
  literal: string | null
  source: RowSource
  /** When the value is a plain reference to another token or primitive: its name and label. */
  follows: { name: string; label: string; primitive: string | null } | null
}

const PLAIN_REFERENCE = /^var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,[^)]*)?\)$/

/** The name a value refers to when it is one plain `var()` (a fallback allowed), or null. */
export function plainReference(value: string): string | null {
  const m = PLAIN_REFERENCE.exec(value.trim())
  return m ? m[1] : null
}

function choiceSource(token: TokenDef | undefined, resolved: ResolvedTheme): RowSource {
  for (const choice of THEME_CHOICES) {
    const option = resolved.choices[choice.name]
    if (option !== undefined && token?.byChoice?.[choice.name]?.[option] !== undefined) {
      return { kind: 'choice', choice: choice.name, choiceLabel: choice.label, option }
    }
  }
  return { kind: 'default' }
}

/** The row for `name` in `mode`. */
export function rowModeView(resolved: ResolvedTheme, name: string, mode: EditorMode): RowModeView {
  const values = resolved[mode]
  const entry = values[name]
  const token = TOKENS_BY_NAME.get(name)
  if (!entry) {
    return { value: '', literal: null, source: token?.optional ? { kind: 'unset' } : { kind: 'default' }, follows: null }
  }
  const value = entry.value
  const reference = plainReference(value)
  const source: RowSource =
    entry.source === 'theme' || entry.source === 'theme-dark'
      ? { kind: 'theme' }
      : entry.source === 'choice'
        ? choiceSource(token, resolved)
        : { kind: 'default' }
  return {
    value,
    literal: resolveLiteral(values, name),
    source,
    follows: reference
      ? { name: reference, label: labelFor(reference), primitive: reference.startsWith('--p-') ? reference.slice(4) : null }
      : null,
  }
}

/** The type check's message for `value` as `token`'s value, or null when it fits (or is empty). */
export function rowProblem(token: TokenDef, value: string): string | null {
  return valueProblem(token.type, value, token.options)
}

/** The type check's message for `value` as a value of `type`, or null when it fits (or is empty). */
export function valueProblem(type: TokenType, value: string, options?: readonly string[]): string | null {
  return value.trim() === '' ? null : typeProblem(type, value, options ?? optionsOf(type))
}

/** The words a font-style value may be. */
export const FONT_STYLE_OPTIONS = ['normal', 'italic', 'oblique'] as const

/** The words a value of `type` may be, when the type alone fixes them. */
function optionsOf(type: TokenType): readonly string[] | undefined {
  return type === 'font-style' ? FONT_STYLE_OPTIONS : undefined
}

/** The words a keyword or font-style token offers, or null when it offers none. */
export function keywordOptions(token: { type: TokenType; options?: readonly string[] }): readonly string[] | null {
  return token.options ?? optionsOf(token.type) ?? null
}

/** Whether the theme sets `name` at all. */
export function isOverridden(tokens: ThemeTokensDocument, name: string): boolean {
  return tokens.tokens[name] !== undefined
}

/** The contrast findings of every pair `name` is in, for `mode`, with the other side named. */
export function rowContrast(
  findings: readonly ContrastFinding[],
  name: string,
  mode: EditorMode,
): Array<{ finding: ContrastFinding; against: string; role: 'foreground' | 'background' }> {
  return findings
    .filter((f) => f.mode === mode && (f.pair.foreground === name || f.pair.background === name))
    .map((f) =>
      f.pair.foreground === name
        ? { finding: f, against: labelFor(f.pair.background), role: 'foreground' as const }
        : { finding: f, against: labelFor(f.pair.foreground), role: 'background' as const },
    )
}

/** Whether `text` is a colour the editor accepts (anything `parseColor` understands). */
export function isAcceptedColour(text: string): boolean {
  return text.trim() !== '' && parseColor(text.trim()) !== null
}

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0')

/** `#rrggbb` for a colour picker, or null when `literal` is not one colour. */
export function pickerHex(literal: string | null): string | null {
  if (!literal) return null
  const c = parseColor(literal)
  return c ? `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}` : null
}

/**
 * The value a picker choice writes: `#rrggbb`, keeping the alpha of the value
 * it replaces (`#rrggbbaa`) so a translucent token stays translucent.
 */
export function pickedValue(hex: string, previousLiteral: string | null): string {
  const previous = previousLiteral ? parseColor(previousLiteral) : null
  return previous && previous.a < 1 ? `${hex}${hex2(previous.a)}` : hex
}

function withToken(tokens: ThemeTokensDocument, name: string, entry: ThemeTokensDocument['tokens'][string] | undefined): ThemeTokensDocument {
  const next = { ...tokens.tokens }
  if (entry === undefined) delete next[name]
  else next[name] = entry
  return { ...tokens, tokens: next }
}

/**
 * Set `name` for `mode`. Light writes the shared value (dark follows it
 * unless the theme sets dark apart); dark writes the dark value beside the
 * light one in force. A literal replaces whatever was there, a primitive
 * reference included.
 */
export function setTokenValue(tokens: ThemeTokensDocument, name: string, mode: EditorMode, value: string): ThemeTokensDocument {
  const own = tokens.tokens[name]
  const dark = own === undefined ? undefined : tokenModes(own).dark
  if (mode === 'light') {
    return withToken(tokens, name, dark === undefined ? value : { value, dark })
  }
  const light = own === undefined ? TOKENS_BY_NAME.get(name)?.default ?? value : tokenModes(own).value
  return withToken(tokens, name, { value: light, dark: value })
}

/** Drop the theme's dark value for `name`, so dark is the same as light again. */
export function clearDarkValue(tokens: ThemeTokensDocument, name: string): ThemeTokensDocument {
  const own = tokens.tokens[name]
  if (own === undefined || typeof own === 'string') return tokens
  return withToken(tokens, name, own.value)
}

/** Drop the theme's value for `name` in both modes: the default is in force again. */
export function resetToken(tokens: ThemeTokensDocument, name: string): ThemeTokensDocument {
  return tokens.tokens[name] === undefined ? tokens : withToken(tokens, name, undefined)
}

/** A draft's primitives as the read-only list shows them. */
export function primitiveRows(tokens: ThemeTokensDocument): Array<{ name: string; variable: string; type: string; value: string; dark?: string }> {
  return Object.entries(tokens.primitives)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, p]) => ({ name, variable: primitiveVar(name), type: p.type, value: p.value, dark: p.dark }))
}

/** The names of the draft's primitives a token of `type` may follow, sorted. */
export function primitivesOfType(tokens: ThemeTokensDocument, type: string): string[] {
  return Object.entries(tokens.primitives)
    .filter(([, p]) => p.type === type)
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b))
}

/** Point `name` in `mode` at the primitive `primitive`. */
export function followPrimitive(tokens: ThemeTokensDocument, name: string, mode: EditorMode, primitive: string): ThemeTokensDocument {
  return setTokenValue(tokens, name, mode, `var(${primitiveVar(primitive)})`)
}

/**
 * Give `name` in `mode` a value of its own in place of the reference it
 * follows: the reference's literal when it resolves to one, else the value
 * the reference names as it is written.
 */
export function detachToLiteral(tokens: ThemeTokensDocument, resolved: ResolvedTheme, name: string, mode: EditorMode): ThemeTokensDocument {
  const view = rowModeView(resolved, name, mode)
  if (!view.follows) return tokens
  const target = resolved[mode][view.follows.name]
  const literal = view.literal ?? target?.value
  return literal ? setTokenValue(tokens, name, mode, literal) : tokens
}

/**
 * Give `name` a dark value apart from light, starting from what dark shows
 * now (so nothing repaints until it is edited).
 */
export function separateDarkValue(tokens: ThemeTokensDocument, resolved: ResolvedTheme, name: string): ThemeTokensDocument {
  const own = tokens.tokens[name]
  if (own !== undefined && tokenModes(own).dark !== undefined) return tokens
  const dark = resolved.dark[name]?.value ?? resolved.light[name]?.value ?? TOKENS_BY_NAME.get(name)?.default
  if (dark === undefined) return tokens
  const light = own === undefined ? resolved.light[name]?.value ?? TOKENS_BY_NAME.get(name)?.default ?? dark : tokenModes(own).value
  return withToken(tokens, name, { value: light, dark })
}

/**
 * Whether dark shows the same value as light for `name`: the theme sets no
 * dark value apart, and (when the theme does not set the token) the
 * registry has no dark default either.
 */
export function darkFollowsLight(tokens: ThemeTokensDocument, name: string): boolean {
  const own = tokens.tokens[name]
  if (own !== undefined) return tokenModes(own).dark === undefined
  return TOKENS_BY_NAME.get(name)?.defaultDark === undefined
}

/**
 * Make dark the same as light again for `name`: drop the theme's dark value,
 * or, where only the registry's dark default differs, write light's value
 * as the theme's own for both modes.
 */
export function joinDarkToLight(tokens: ThemeTokensDocument, resolved: ResolvedTheme, name: string): ThemeTokensDocument {
  if (darkFollowsLight(tokens, name)) return tokens
  if (tokens.tokens[name] !== undefined) return clearDarkValue(tokens, name)
  const light = resolved.light[name]?.value
  return light === undefined ? tokens : withToken(tokens, name, light)
}

/** Pick `option` of the choice `choice`; the choice's default is written as no entry at all. */
export function setChoice(tokens: ThemeTokensDocument, choice: string, option: string): ThemeTokensDocument {
  const def = THEME_CHOICES.find((c) => c.name === choice)
  if (!def || !def.options.includes(option)) return tokens
  const next = { ...tokens.choices }
  if (option === def.default) delete next[choice]
  else next[choice] = option
  if (tokens.choices[choice] === next[choice]) return tokens
  return { ...tokens, choices: next }
}

/** The primitives a filter shows: all of them (each is the theme's own), narrowed by a search on the name. */
export function filterPrimitiveRows<T extends { name: string; variable: string }>(rows: readonly T[], filter: EditorFilter): T[] {
  const q = filter.query.trim().toLowerCase()
  return q ? rows.filter((r) => r.name.toLowerCase().includes(q) || r.variable.toLowerCase().includes(q)) : [...rows]
}

// ---------------------------------------------------------------------------
// Undo and redo (Spec E decision 9): the tokens document for this session.

/** How long successive edits of one value are held as one step (a colour drag). */
export const HISTORY_COALESCE_MS = 1000
/** How many steps are kept. */
export const HISTORY_LIMIT = 200

export interface HistoryStep {
  doc: ThemeTokensDocument
  /** What was edited (a token and mode, say); edits of one key in quick succession are one step. */
  key: string | null
  at: number
}

export interface EditHistory {
  past: readonly HistoryStep[]
  future: readonly ThemeTokensDocument[]
}

export const EMPTY_HISTORY: EditHistory = { past: [], future: [] }

/**
 * Record that the document was `before` and an edit of `key` at `now`
 * replaced it. An edit of the same key within `HISTORY_COALESCE_MS` of the
 * last joins that step (its `before` stays the step's). Any edit clears redo.
 */
export function recordEdit(history: EditHistory, before: ThemeTokensDocument, key: string | null, now: number): EditHistory {
  const last = history.past[history.past.length - 1]
  if (last && key !== null && last.key === key && now - last.at < HISTORY_COALESCE_MS) {
    return { past: [...history.past.slice(0, -1), { ...last, at: now }], future: [] }
  }
  const past = [...history.past, { doc: before, key, at: now }]
  return { past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past, future: [] }
}

/** Undo from `present`: the document to show and the history after, or null when there is nothing to undo. */
export function undoStep(history: EditHistory, present: ThemeTokensDocument): { doc: ThemeTokensDocument; history: EditHistory } | null {
  const last = history.past[history.past.length - 1]
  if (!last) return null
  return { doc: last.doc, history: { past: history.past.slice(0, -1), future: [present, ...history.future] } }
}

/** Redo from `present`, or null when there is nothing to redo. */
export function redoStep(history: EditHistory, present: ThemeTokensDocument): { doc: ThemeTokensDocument; history: EditHistory } | null {
  const [next, ...rest] = history.future
  if (!next) return null
  return { doc: next, history: { past: [...history.past, { doc: present, key: null, at: 0 }], future: rest } }
}

// ---------------------------------------------------------------------------
// One row's view, which is all a row reads from the editor's state.

/** What the editor holds while it renders: the draft's tokens, their analysis and the mode on display. */
export interface EditorSnapshot {
  tokens: ThemeTokensDocument
  resolved: ResolvedTheme
  findings: readonly ContrastFinding[]
  mode: EditorMode
}

/** Everything one token's row shows. Plain data, so a row can skip a render when its view is unchanged. */
export interface TokenRowView {
  mode: EditorMode
  shown: RowModeView
  light: RowModeView
  dark: RowModeView
  /** The theme sets the token. */
  overridden: boolean
  /** Dark shows the same value as light. */
  sameAsLight: boolean
  /** The type check's message for each mode's value, when it does not fit. */
  problems: { light: string | null; dark: string | null }
  /** The contrast of each pair the token is in, for the mode on display (colours only). */
  contrast: ReturnType<typeof rowContrast>
  /** The draft's primitives of the token's type. */
  primitives: string[]
  /** For a font weight: the first family of the font in force where it is read, in the mode on display. */
  familyInForce: string | null
}

export function tokenRowView(token: TokenDef, snapshot: EditorSnapshot): TokenRowView {
  const { tokens, resolved, findings, mode } = snapshot
  const light = rowModeView(resolved, token.name, 'light')
  const dark = rowModeView(resolved, token.name, 'dark')
  const overridden = isOverridden(tokens, token.name)
  return {
    mode,
    shown: mode === 'light' ? light : dark,
    light,
    dark,
    overridden,
    sameAsLight: darkFollowsLight(tokens, token.name),
    problems: {
      light: overridden ? rowProblem(token, light.value) : null,
      dark: overridden ? rowProblem(token, dark.value) : null,
    },
    contrast: token.type === 'color' ? rowContrast(findings, token.name, mode) : [],
    primitives: primitivesOfType(tokens, token.type),
    familyInForce: token.type === 'font-weight' ? firstFamilyInForce(resolved, mode, weightFamilyToken(token.name)) : null,
  }
}

// ---------------------------------------------------------------------------
// The draft's fonts and images: what the font and image controls offer.

/** One font the draft's manifest declares, with the weights and styles its faces cover. */
export interface DraftFont {
  family: string
  weights: number[]
  styles: string[]
}

/** One image file in the draft. */
export interface DraftImage {
  path: string
  /** Where the draft serves it, for a thumbnail; null when it is not served yet. */
  url: string | null
}

/** What the draft itself offers the controls. */
export interface DraftResources {
  fonts: DraftFont[]
  images: DraftImage[]
}

export const EMPTY_RESOURCES: DraftResources = { fonts: [], images: [] }

/**
 * The weights one `@font-face` covers: `normal` 400, `bold` 700, a range
 * every hundred from one end to the other, and 400 when it names none.
 */
export function declaredWeights(weight: string | undefined): number[] {
  const w = (weight ?? '').trim()
  if (w === '' || w === 'normal') return [400]
  if (w === 'bold') return [700]
  const [from, to = from] = w.split(/\s+/).map(Number)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return []
  const out: number[] = []
  for (let n = Math.min(from, to); n <= Math.max(from, to); n += 100) out.push(n)
  return out
}

/**
 * The draft's fonts (faces of one family gathered, weights and styles
 * merged and sorted) and its images, from the manifest and the image list
 * the server returns. A malformed font entry is skipped.
 */
export function draftResources(manifest: Record<string, unknown> | null, images: readonly DraftImage[]): DraftResources {
  const byFamily = new Map<string, { weights: Set<number>; styles: Set<string> }>()
  const fonts = Array.isArray(manifest?.fonts) ? (manifest.fonts as unknown[]) : []
  for (const f of fonts) {
    if (!f || typeof f !== 'object') continue
    const { family, weight, style } = f as { family?: unknown; weight?: unknown; style?: unknown }
    if (typeof family !== 'string' || family.trim() === '') continue
    const entry = byFamily.get(family) ?? { weights: new Set<number>(), styles: new Set<string>() }
    for (const n of declaredWeights(typeof weight === 'string' ? weight : undefined)) entry.weights.add(n)
    entry.styles.add(typeof style === 'string' ? style : 'normal')
    byFamily.set(family, entry)
  }
  return {
    fonts: [...byFamily.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([family, e]) => ({ family, weights: [...e.weights].sort((a, b) => a - b), styles: [...e.styles].sort() })),
    images: images.map((i) => ({ path: i.path, url: i.url })),
  }
}

/** Font stacks every system has, offered beside the draft's own fonts (Spec E decision 2). */
export const SYSTEM_FONT_STACKS: ReadonlyArray<{ label: string; families: readonly string[] }> = [
  { label: 'System sans-serif', families: ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'] },
  { label: 'System serif', families: ['ui-serif', 'Georgia', 'Cambria', 'Times New Roman', 'Times', 'serif'] },
  { label: 'System monospace', families: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'Liberation Mono', 'Courier New', 'monospace'] },
  { label: 'System rounded', families: ['ui-rounded', 'system-ui', 'sans-serif'] },
  { label: 'Handwriting (cursive)', families: ['cursive'] },
]

/** `stack` with `add` appended, leaving out any family already in it (ignoring case). */
export function appendFamilies(stack: readonly string[], add: readonly string[]): string[] {
  const seen = new Set(stack.map((f) => f.toLowerCase()))
  const out = [...stack]
  for (const f of add) {
    const key = f.trim().toLowerCase()
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    out.push(f.trim())
  }
  return out
}

/** `list` with the item at `index` moved by `by` places (kept inside the list). */
export function moveItem<T>(list: readonly T[], index: number, by: number): T[] {
  const to = Math.max(0, Math.min(list.length - 1, index + by))
  if (to === index || index < 0 || index >= list.length) return [...list]
  const out = [...list]
  const [item] = out.splice(index, 1)
  out.splice(to, 0, item)
  return out
}

/** The font-family token a weight token is read beside. */
const WEIGHT_FAMILIES: Readonly<Record<string, string>> = {
  '--qt-heading-font-weight': '--qt-heading-font',
  '--qt-chat-assistant-font-weight': '--qt-chat-assistant-font',
}

/** The font-family token whose font a weight token weighs: its own place's, else the body font. */
export function weightFamilyToken(weightToken: string): string {
  return WEIGHT_FAMILIES[weightToken] ?? '--theme-font-sans'
}

/** The first family of `familyToken`'s font in `mode`, or null when it does not come down to a font stack. */
export function firstFamilyInForce(resolved: ResolvedTheme, mode: EditorMode, familyToken: string): string | null {
  const literal = resolveLiteral(resolved[mode], familyToken) ?? resolved[mode][familyToken]?.value
  if (!literal) return null
  const first = parseFontStack(literal)?.families[0]
  return first && !first.startsWith('var(') ? first : null
}

/** The weights the draft's font `family` declares, or null when `family` is not one of the draft's fonts. */
export function draftFontWeights(resources: DraftResources, family: string | null): number[] | null {
  if (!family) return null
  const font = resources.fonts.find((f) => f.family.toLowerCase() === family.toLowerCase())
  return font ? font.weights : null
}

/** The numeric weight a font-weight value names, for marking declared weights (`normal` 400, `bold` 700). */
export function weightNumber(value: string): number | null {
  const v = value.trim().toLowerCase()
  if (v === 'normal') return 400
  if (v === 'bold') return 700
  return /^\d{1,4}$/.test(v) ? Number(v) : null
}

/** Whether `text` is a timing function a transition accepts (a keyword, or `cubic-bezier()` / `steps()` / `linear()`). */
export function isEasing(text: string): boolean {
  const t = text.trim()
  return t !== '' && parseTransition(`all 1s ${t}`)?.layers[0]?.easing === t
}

// ---------------------------------------------------------------------------
// The primitives panel.

/** One mode of a primitive as its row shows it. */
export interface PrimitiveModeView {
  value: string
  literal: string | null
}

/** Everything one primitive's row shows. */
export interface PrimitiveRowView {
  name: string
  variable: string
  type: ThemePrimitive['type']
  light: PrimitiveModeView
  dark: PrimitiveModeView
  /** It has no dark value of its own. */
  sameAsLight: boolean
  /** The tokens (with their labels) and primitives that follow it. */
  users: { tokens: Array<{ name: string; label: string }>; primitives: string[] }
}

/** The draft's primitive names, sorted. */
export function primitiveNames(tokens: ThemeTokensDocument): string[] {
  return Object.keys(tokens.primitives).sort((a, b) => a.localeCompare(b))
}

/** The row for primitive `name`, or null when the draft has none of that name. */
export function primitiveRowView(name: string, snapshot: EditorSnapshot): PrimitiveRowView | null {
  const p = snapshot.tokens.primitives[name]
  if (!p) return null
  const variable = primitiveVar(name)
  const mode = (m: EditorMode): PrimitiveModeView => ({
    value: m === 'dark' ? p.dark ?? p.value : p.value,
    literal: resolveLiteral(snapshot.resolved[m], variable),
  })
  const users = primitiveUsers(snapshot.tokens, name)
  return {
    name,
    variable,
    type: p.type,
    light: mode('light'),
    dark: mode('dark'),
    sameAsLight: p.dark === undefined,
    users: {
      tokens: users.tokens.sort().map((n) => ({ name: n, label: labelFor(n) })),
      primitives: users.primitives.sort(),
    },
  }
}

/** A starting value for a new primitive of `type`, so the add form opens on something valid. */
export function primitiveStarter(type: ThemePrimitive['type']): string {
  switch (type) {
    case 'color':
      return '#336699'
    case 'length':
      return '1rem'
    case 'radius':
      return '0.5rem'
    case 'shadow':
      return '0 2px 6px rgb(0 0 0 / 0.15)'
    case 'font-family':
      return 'system-ui, sans-serif'
    case 'font-weight':
      return '400'
    case 'duration':
      return '150ms'
    case 'easing':
      return 'ease'
    case 'opacity':
      return '0.5'
    case 'image':
      return 'none'
    case 'number':
      return '1'
    default:
      return 'none'
  }
}
