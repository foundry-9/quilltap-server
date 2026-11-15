/**
 * Calliope's Atelier — the theme editor's pure model.
 *
 * Everything the editor computes from a draft lives here, over the browser
 * entry of the theme engine (`lib/themes/engine/client.ts`) and nothing else:
 * which tokens are editable and in which sections, the preview CSS (the
 * server's compiled font faces, icons and custom CSS around the tokens the
 * editor emits, in injector order), what a row shows (value in force, its
 * source, the contrast of each pair it is in) and the edits (set a mode,
 * reset). No React, no fetch.
 *
 * @module components/theme-editor/model
 */

import {
  CLIENT_REGISTRY_VIEW,
  CONTRAST_PAIRS,
  TOKEN_GROUPS,
  THEME_TOKENS,
  checkContrast,
  deriveThemeFeatures,
  emitThemeCss,
  parseColor,
  primitiveVar,
  resolveLiteral,
  resolveTheme,
  tokenModes,
  type ContrastFinding,
  type ResolvedTheme,
  type ThemeTokensDocument,
  type TokenDef,
} from '@/lib/themes/engine/client'
import type { ThemePreview } from '@/components/providers/theme/types'

export type EditorMode = 'light' | 'dark'

/** A section of the editor: one registry group's editable colour tokens. */
export interface EditorSection {
  id: string
  label: string
  description?: string
  tokens: readonly TokenDef[]
}

/** A token the editor offers: a standard semantic colour. */
export function isEditableToken(token: TokenDef): boolean {
  return token.type === 'color' && token.tier === 'semantic' && token.visibility === 'standard'
}

/** One section per registry group that has an editable token, in registry order. */
export const EDITOR_SECTIONS: readonly EditorSection[] = TOKEN_GROUPS.map((group) => ({
  id: group.id,
  label: group.label,
  description: group.description,
  tokens: group.tokens.filter(isEditableToken),
})).filter((section) => section.tokens.length > 0)

const TOKENS_BY_NAME: ReadonlyMap<string, TokenDef> = new Map(THEME_TOKENS.map((t) => [t.name, t]))

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
  | { kind: 'theme' }

/** What one row shows for one mode. */
export interface RowModeView {
  /** The value as written (may be a `var()`). */
  value: string
  /** The value with every reference substituted, or null when it does not resolve. */
  literal: string | null
  source: RowSource
  /** When the value is a plain reference to another token or primitive: its name and label. */
  follows: { name: string; label: string } | null
}

const PLAIN_REFERENCE = /^var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,[^)]*)?\)$/

/** The row for `name` in `mode`. */
export function rowModeView(resolved: ResolvedTheme, name: string, mode: EditorMode): RowModeView {
  const values = resolved[mode]
  const entry = values[name]
  const value = entry?.value ?? ''
  const reference = PLAIN_REFERENCE.exec(value.trim())
  return {
    value,
    literal: entry ? resolveLiteral(values, name) : null,
    source: entry && (entry.source === 'theme' || entry.source === 'theme-dark') ? { kind: 'theme' } : { kind: 'default' },
    follows: reference ? { name: reference[1], label: labelFor(reference[1]) } : null,
  }
}

/** The theme's own dark value for `name`, when it sets one apart from light. */
export function ownDarkValue(tokens: ThemeTokensDocument, name: string): string | undefined {
  const own = tokens.tokens[name]
  return own === undefined ? undefined : tokenModes(own).dark
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
