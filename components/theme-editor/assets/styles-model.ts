/**
 * Calliope's Atelier — what the Custom CSS section shows, read from a draft.
 *
 * Pure and client-safe (Calliope Live, Spec G, Stage 2): the markers the
 * code editor draws from the draft's issues, and the three reference lists
 * that stand in for completion (decision 3) — the hook catalogue with every
 * selector a hook can be written as, the registry tokens and the draft's
 * primitives with the value in force, and the draft's images — each with
 * the text that choosing it inserts.
 *
 * @module components/theme-editor/assets/styles-model
 */

import { HOOKS, HOOK_SURFACES, HOOK_SURFACE_TITLES, type HookDef, type HookSurface } from '@/lib/themes/hooks'
import { THEME_TOKENS, primitiveVar, type ResolvedTheme, type ThemeTokensDocument } from '@/lib/themes/engine/client'
import type { CodeEditorMarker } from '@/components/code-editor'
import type { DraftDetail } from '../use-theme-drafts'
import type { EditorMode } from '../model'

type DraftIssue = DraftDetail['issues'][number]

// ---------------------------------------------------------------------------
// Issues and markers

/** The draft's issues that belong to its stylesheet at `path`. */
export function stylesheetIssues(issues: readonly DraftIssue[], path: string): DraftIssue[] {
  return issues.filter((i) => i.file === path)
}

/** The code editor's markers for the stylesheet's issues: one per issue that knows its line. */
export function stylesheetMarkers(issues: readonly DraftIssue[], path: string): CodeEditorMarker[] {
  return stylesheetIssues(issues, path)
    .filter((i): i is DraftIssue & { line: number } => typeof i.line === 'number' && i.line > 0)
    .map((i) => ({ line: i.line, severity: i.severity, message: i.message }))
}

/** True when the stylesheet, as last saved, has an error. */
export function stylesheetHasErrors(issues: readonly DraftIssue[], path: string): boolean {
  return stylesheetIssues(issues, path).some((i) => i.severity === 'error')
}

// ---------------------------------------------------------------------------
// Hooks

/** One way of writing a hook as a selector. */
export interface HookSelector {
  selector: string
  /** What the selector picks out, in words. */
  label: string
}

/** Every selector a hook can be written as: the class alone, then each variant value, then each state. */
export function hookSelectors(hook: HookDef): HookSelector[] {
  const base = `.${hook.className}`
  const out: HookSelector[] = [{ selector: base, label: `Every ${hook.label.toLowerCase()}` }]
  for (const variant of hook.variants ?? []) {
    if (variant.values === 'open') {
      out.push({ selector: `${base}[${variant.attribute}]`, label: `With any ${variant.attribute}` })
      continue
    }
    for (const value of variant.values) {
      out.push({ selector: `${base}[${variant.attribute}="${value}"]`, label: `${variant.attribute} = ${value}` })
    }
  }
  for (const state of hook.states ?? []) {
    if (state.kind === 'class') {
      out.push({ selector: `${base}.${state.className}`, label: state.label })
    } else {
      for (const value of state.values) {
        out.push({ selector: `${base}[${state.attribute}="${value}"]`, label: `${state.label} (${state.attribute}="${value}")` })
      }
    }
  }
  return out
}

export interface HookGroup {
  surface: HookSurface
  title: string
  hooks: HookDef[]
}

const hookMatches = (hook: HookDef, q: string) =>
  hook.label.toLowerCase().includes(q) ||
  hook.className.includes(q) ||
  (hook.description?.toLowerCase().includes(q) ?? false) ||
  (hook.variants ?? []).some((v) => v.attribute.includes(q) || (v.values !== 'open' && v.values.some((x) => x.toLowerCase().includes(q)))) ||
  (hook.states ?? []).some((s) => s.label.toLowerCase().includes(q) || (s.kind === 'class' ? s.className.includes(q) : s.attribute.includes(q)))

/** The catalogue grouped by surface, in the reference document's order, narrowed by `query`. */
export function hookGroups(query: string, hooks: readonly HookDef[] = HOOKS): HookGroup[] {
  const q = query.trim().toLowerCase()
  return HOOK_SURFACES.map((surface) => ({
    surface,
    title: HOOK_SURFACE_TITLES[surface],
    hooks: hooks.filter((h) => h.surface === surface && (!q || hookMatches(h, q))),
  })).filter((g) => g.hooks.length > 0)
}

// ---------------------------------------------------------------------------
// Tokens and primitives

export interface TokenEntry {
  /** The custom property. */
  name: string
  label: string
  kind: 'token' | 'primitive'
  /** The value in force in the mode shown, as written; empty when it has none. */
  value: string
  /** What choosing it inserts. */
  insert: string
}

/** The registry tokens and the draft's primitives, the primitives first, with their values in force in `mode`. */
export function tokenEntries(tokens: ThemeTokensDocument, resolved: ResolvedTheme, mode: EditorMode): TokenEntry[] {
  const values = resolved[mode]
  const primitives: TokenEntry[] = Object.keys(tokens.primitives)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const variable = primitiveVar(name)
      const p = tokens.primitives[name]
      return {
        name: variable,
        label: `Primitive ${name}`,
        kind: 'primitive',
        value: values[variable]?.value ?? (mode === 'dark' && p.dark !== undefined ? p.dark : p.value),
        insert: `var(${variable})`,
      }
    })
  const registry: TokenEntry[] = THEME_TOKENS.map((t) => ({
    name: t.name,
    label: t.label,
    kind: 'token',
    value: values[t.name]?.value ?? '',
    insert: `var(${t.name})`,
  }))
  return [...primitives, ...registry]
}

/** The entries whose name, label or value answer `query`. */
export function filterTokenEntries(entries: readonly TokenEntry[], query: string): TokenEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...entries]
  return entries.filter((e) => e.name.toLowerCase().includes(q) || e.label.toLowerCase().includes(q) || e.value.toLowerCase().includes(q))
}

// ---------------------------------------------------------------------------
// Images

export interface ImageEntry {
  path: string
  /** Where the draft serves it, or null when it cannot be shown. */
  url: string | null
  insert: string
}

/** `url('…')` for a bundle path, with any quote or backslash escaped. */
export function cssUrlFor(path: string): string {
  return `url('${path.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')`
}

/** The draft's raster and vector images, narrowed by `query`, each inserting its `url()`. */
export function imageEntries(images: DraftDetail['images'], query: string): ImageEntry[] {
  const q = query.trim().toLowerCase()
  return images
    .filter((i) => !q || i.path.toLowerCase().includes(q))
    .map((i) => ({ path: i.path, url: i.url, insert: cssUrlFor(i.path) }))
}
