/**
 * Theme hook lint — pure functions over the catalogue, the app's markup and a
 * theme stylesheet. `scripts/check-theme-hooks.ts` runs them in
 * `npm run lint`; the theme editor and LLM assistance will call
 * {@link lintThemeSelectors} on a theme's custom CSS.
 *
 *  1. {@link lintCatalogue} — the catalogue is well-formed.
 *  2. {@link lintMarkup} — every catalogued hook is in the markup, and every
 *     literal variant value written in TSX is one the catalogue lists.
 *  3. {@link lintThemeSelectors} — what a stylesheet targets that is not a
 *     hook. Report-only for the bundled themes until Spec C.
 *
 * @module lib/themes/hooks/lint
 */

import postcss, { type AtRule, type Rule } from 'postcss'
import { ROOT_HOOKS } from './index'
import type { HookCatalogue, HookDef, RemovedHook } from './types'

// ============================================================================
// 1 + 2. Catalogue and markup
// ============================================================================

export type HookLintRule = 'catalogue' | 'markup' | 'variant-value'

export interface HookLintIssue {
  rule: HookLintRule
  message: string
  className?: string
  file?: string
  line?: number
}

export interface SourceFile {
  /** Repo-relative path. */
  path: string
  content: string
}

/** Every class a catalogue names: hook classes and state classes. */
export function catalogueClassNames(catalogue: HookCatalogue): Set<string> {
  const names = new Set<string>()
  for (const hook of catalogue.hooks) {
    names.add(hook.className)
    for (const state of hook.states ?? []) {
      if (state.kind === 'class') names.add(state.className)
    }
  }
  return names
}

/** Rule 1: unique classes; `within` names a hook; nothing both catalogued and removed. */
export function lintCatalogue(catalogue: HookCatalogue): HookLintIssue[] {
  const issues: HookLintIssue[] = []
  const hookClasses = new Set<string>()
  for (const hook of catalogue.hooks) {
    if (hookClasses.has(hook.className)) {
      issues.push({ rule: 'catalogue', className: hook.className, message: `hook \`${hook.className}\` is catalogued twice` })
    }
    hookClasses.add(hook.className)
    if (hook.since < 1 || hook.since > catalogue.version) {
      issues.push({
        rule: 'catalogue',
        className: hook.className,
        message: `hook \`${hook.className}\` has since: ${hook.since}, outside 1…${catalogue.version}`,
      })
    }
  }
  const allClasses = catalogueClassNames(catalogue)
  const removed = new Set<string>()
  for (const gone of catalogue.removed) {
    if (removed.has(gone.className)) {
      issues.push({ rule: 'catalogue', className: gone.className, message: `\`${gone.className}\` is in REMOVED_HOOKS twice` })
    }
    removed.add(gone.className)
    if (allClasses.has(gone.className)) {
      issues.push({
        rule: 'catalogue',
        className: gone.className,
        message: `\`${gone.className}\` is both catalogued and in REMOVED_HOOKS`,
      })
    }
    if (gone.replacedBy && !allClasses.has(gone.replacedBy)) {
      issues.push({
        rule: 'catalogue',
        className: gone.className,
        message: `\`${gone.className}\` is replaced by \`${gone.replacedBy}\`, which is not catalogued`,
      })
    }
  }
  for (const hook of catalogue.hooks) {
    for (const parent of hook.within ?? []) {
      if (!hookClasses.has(parent)) {
        issues.push({
          rule: 'catalogue',
          className: hook.className,
          message: `hook \`${hook.className}\` is within \`${parent}\`, which is not a catalogued hook`,
        })
      }
    }
    const stateClasses = new Set<string>()
    for (const state of hook.states ?? []) {
      if (state.kind !== 'class') continue
      if (stateClasses.has(state.className) || state.className === hook.className) {
        issues.push({
          rule: 'catalogue',
          className: hook.className,
          message: `hook \`${hook.className}\` lists state \`${state.className}\` twice (or as itself)`,
        })
      }
      stateClasses.add(state.className)
    }
    for (const variant of hook.variants ?? []) {
      if (variant.values !== 'open') {
        if (variant.values.length === 0) {
          issues.push({
            rule: 'catalogue',
            className: hook.className,
            message: `hook \`${hook.className}\` has an empty value list for \`${variant.attribute}\``,
          })
        }
        if (new Set(variant.values).size !== variant.values.length) {
          issues.push({
            rule: 'catalogue',
            className: hook.className,
            message: `hook \`${hook.className}\` repeats a value of \`${variant.attribute}\``,
          })
        }
      }
    }
  }
  return issues
}

const QT_TOKEN = /qt-[a-z0-9-]+/g
const DATA_TOKEN = /data-[a-z0-9-]+/g

function tokensOf(content: string, pattern: RegExp): Set<string> {
  return new Set(content.match(pattern) ?? [])
}

/** The static part of a composed class: everything up to and including its last `-`. */
function composedPrefix(className: string): string {
  return className.slice(0, className.lastIndexOf('-') + 1)
}

function missingMessage(name: string): string {
  return `catalogued hook \`${name}\` is no longer in the markup: restore it, or move it to REMOVED_HOOKS and raise HOOK_CATALOGUE_VERSION`
}

/**
 * Closed value lists by attribute, unioned across hooks. An attribute any
 * hook declares `'open'` is absent: its literals are not checked.
 */
export function closedVariantValues(catalogue: HookCatalogue): Map<string, Set<string>> {
  const open = new Set<string>()
  const closed = new Map<string, Set<string>>()
  for (const hook of catalogue.hooks) {
    for (const variant of hook.variants ?? []) {
      if (variant.values === 'open') {
        open.add(variant.attribute)
        continue
      }
      const set = closed.get(variant.attribute) ?? new Set<string>()
      for (const value of variant.values) set.add(value)
      closed.set(variant.attribute, set)
    }
  }
  for (const attribute of open) closed.delete(attribute)
  return closed
}

/** `data-x="v"`, `data-x='v'`, `data-x={'v'}` and `'data-x': 'v'`. */
const LITERAL_VALUE_PATTERNS = [
  /\b(data-[a-z0-9-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*(?:"([^"]*)"|'([^']*)'|`([^`$]*)`)\s*\})/g,
  /["'](data-[a-z0-9-]+)["']\s*:\s*(?:"([^"]*)"|'([^']*)')/g,
]

function lineOf(content: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i++) if (content.charCodeAt(i) === 10) line++
  return line
}

/** Rules 2 and 3: every hook is in the markup; every literal variant value is listed. */
export function lintMarkup(catalogue: HookCatalogue, files: readonly SourceFile[]): HookLintIssue[] {
  const issues: HookLintIssue[] = []
  const qtTokens = new Set<string>()
  const dataTokens = new Set<string>()
  const byPath = new Map<string, SourceFile>()
  for (const file of files) {
    byPath.set(file.path, file)
    for (const token of tokensOf(file.content, QT_TOKEN)) qtTokens.add(token)
    for (const token of tokensOf(file.content, DATA_TOKEN)) dataTokens.add(token)
  }

  const present = (hook: HookDef, className: string): boolean => {
    if (hook.composedIn) {
      const file = byPath.get(hook.composedIn)
      return !!file && (file.content.includes(className) || file.content.includes(composedPrefix(className)))
    }
    return qtTokens.has(className)
  }

  const reported = new Set<string>()
  const report = (name: string) => {
    if (reported.has(name)) return
    reported.add(name)
    issues.push({ rule: 'markup', className: name, message: missingMessage(name) })
  }

  for (const hook of catalogue.hooks) {
    if (!present(hook, hook.className)) report(hook.className)
    for (const state of hook.states ?? []) {
      if (state.kind === 'class' && !present(hook, state.className)) report(state.className)
    }
    for (const variant of hook.variants ?? []) {
      const found = hook.composedIn
        ? !!byPath.get(hook.composedIn)?.content.includes(variant.attribute)
        : dataTokens.has(variant.attribute)
      if (!found) report(variant.attribute)
    }
  }

  const closed = closedVariantValues(catalogue)
  for (const file of files) {
    for (const pattern of LITERAL_VALUE_PATTERNS) {
      pattern.lastIndex = 0
      for (const match of file.content.matchAll(pattern)) {
        const attribute = match[1]
        const allowed = closed.get(attribute)
        if (!allowed) continue
        const value = match.slice(2).find((group) => group !== undefined) ?? ''
        if (allowed.has(value)) continue
        issues.push({
          rule: 'variant-value',
          file: file.path,
          line: lineOf(file.content, match.index ?? 0),
          message: `\`${attribute}="${value}"\` is not a catalogued value (expected one of: ${[...allowed].join(', ')})`,
        })
      }
    }
  }
  return issues
}

// ============================================================================
// 3. Theme selectors
// ============================================================================

export interface SelectorAttribute {
  name: string
  /** `=`, `*=`, `^=`, `$=`, `~=`, `|=`, or null for presence (`[name]`). */
  operator: string | null
  value: string | null
}

export interface SelectorTokens {
  classes: string[]
  attributes: SelectorAttribute[]
  /** Type selectors (`h1`, `button`), lower-cased. `*` is not included. */
  elements: string[]
  ids: string[]
}

/** Pseudo-classes whose argument is itself a selector list. */
const SELECTOR_PSEUDOS = new Set(['is', 'not', 'where', 'has', 'matches', 'any', '-webkit-any', '-moz-any', 'host', 'host-context', 'slotted'])

function isIdentChar(ch: string): boolean {
  return /[A-Za-z0-9_\- -￿]/.test(ch)
}

/** Read an identifier (with CSS escapes) from `start`; returns [ident, end]. */
function readIdent(text: string, start: number): [string, number] {
  let i = start
  let out = ''
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\\' && i + 1 < text.length) {
      const hex = /^[0-9a-fA-F]{1,6}\s?/.exec(text.slice(i + 1))
      if (hex) {
        out += String.fromCodePoint(parseInt(hex[0].trim(), 16))
        i += 1 + hex[0].length
      } else {
        out += text[i + 1]
        i += 2
      }
      continue
    }
    if (!isIdentChar(ch)) break
    out += ch
    i++
  }
  return [out, i]
}

/** Index just past the bracket or paren that closes the one at `start`, respecting quotes. */
function skipBalanced(text: string, start: number, open: string, close: string): number {
  let depth = 0
  let quote: string | null = null
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return text.length
}

function parseAttribute(body: string): SelectorAttribute {
  const match = /^\s*([^\s~|^$*=\]]+)\s*(?:([~|^$*]?=)\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^\s\]]+))\s*(?:[iIsS])?\s*)?$/.exec(body)
  if (!match) return { name: body.trim(), operator: null, value: null }
  const value = match[3] ?? match[4] ?? match[5] ?? null
  return { name: match[1].toLowerCase(), operator: match[2] ?? null, value }
}

/**
 * Pull the classes, attributes, type selectors and ids out of one selector
 * (or a comma list), descending into `:is()`, `:not()`, `:where()`, `:has()`.
 */
export function tokenizeSelector(selector: string, into?: SelectorTokens): SelectorTokens {
  const tokens = into ?? { classes: [], attributes: [], elements: [], ids: [] }
  let i = 0
  while (i < selector.length) {
    const ch = selector[i]
    if (ch === '.') {
      const [name, end] = readIdent(selector, i + 1)
      if (name) tokens.classes.push(name)
      i = Math.max(end, i + 1)
    } else if (ch === '#') {
      const [name, end] = readIdent(selector, i + 1)
      if (name) tokens.ids.push(name)
      i = Math.max(end, i + 1)
    } else if (ch === '[') {
      const end = skipBalanced(selector, i, '[', ']')
      tokens.attributes.push(parseAttribute(selector.slice(i + 1, end - 1)))
      i = end
    } else if (ch === ':') {
      let j = i + 1
      if (selector[j] === ':') j++
      const [name, end] = readIdent(selector, j)
      i = end
      if (selector[i] === '(') {
        const close = skipBalanced(selector, i, '(', ')')
        if (SELECTOR_PSEUDOS.has(name.toLowerCase())) tokenizeSelector(selector.slice(i + 1, close - 1), tokens)
        i = close
      }
    } else if (ch === '"' || ch === "'") {
      // A stray string (inside an unparsed pseudo argument); skip it.
      const q = ch
      i++
      while (i < selector.length && selector[i] !== q) i += selector[i] === '\\' ? 2 : 1
      i++
    } else if (/[A-Za-z_\\-]/.test(ch) || ch.charCodeAt(0) > 0x7f) {
      const [name, end] = readIdent(selector, i)
      if (name) tokens.elements.push(name.toLowerCase())
      i = Math.max(end, i + 1)
    } else {
      // Combinators, whitespace, commas, `*`, `&`, `%` and digits (keyframe stops).
      i++
    }
  }
  return tokens
}

export type SelectorReasonCode =
  | 'removed-hook'
  | 'uncatalogued-qt-class'
  | 'non-qt-class'
  | 'bare-element'
  | 'class-substring'
  | 'uncatalogued-attribute'
  | 'unknown-variant-value'

export interface SelectorReason {
  code: SelectorReasonCode
  /** The class, attribute or element at fault. */
  token: string
  message: string
}

export interface SelectorFinding {
  line: number
  selector: string
  reasons: SelectorReason[]
}

/** Elements a theme may select bare. */
const ALLOWED_ELEMENTS = new Set(['html', 'body'])
/** Data attributes the app sets outside the catalogue's variants that a theme may use. */
const ALLOWED_DATA_ATTRIBUTES = new Set<string>([...ROOT_HOOKS.attributes, 'data-qt-modal'])
const SUBSTRING_OPERATORS = new Set(['*=', '^=', '$=', '|='])

function isInsideKeyframes(rule: Rule): boolean {
  let node: { type: string; parent?: unknown } | undefined = rule.parent as { type: string; parent?: unknown } | undefined
  while (node) {
    if (node.type === 'atrule' && /keyframes$/i.test((node as unknown as AtRule).name)) return true
    node = node.parent as { type: string; parent?: unknown } | undefined
  }
  return false
}

/**
 * What a stylesheet targets that is not a structural hook: (a) a removed
 * hook, (b) an uncatalogued `qt-*` class, (c) a non-`qt` class, (d) a bare
 * element other than `html` / `body`, (e) a class-substring attribute
 * selector — plus a data attribute the catalogue does not list, an inline
 * `style` match, and a catalogued attribute given a value it does not list.
 * One finding per selector (each member of a comma list stands alone).
 */
export function lintThemeSelectors(css: string, catalogue: HookCatalogue): SelectorFinding[] {
  const root = postcss.parse(css)
  const removed = new Map<string, RemovedHook>(catalogue.removed.map((hook) => [hook.className, hook]))
  const known = catalogueClassNames(catalogue)
  const closed = closedVariantValues(catalogue)
  const variantAttributes = new Set<string>()
  for (const hook of catalogue.hooks) {
    for (const variant of hook.variants ?? []) variantAttributes.add(variant.attribute)
  }
  const rootClasses = new Set<string>(ROOT_HOOKS.classes)

  const findings: SelectorFinding[] = []
  root.walkRules((rule) => {
    if (isInsideKeyframes(rule)) return
    const line = rule.source?.start?.line ?? 0
    for (const selector of rule.selectors) {
      const tokens = tokenizeSelector(selector)
      const reasons: SelectorReason[] = []
      for (const cls of tokens.classes) {
        const gone = removed.get(cls)
        if (gone) {
          reasons.push({
            code: 'removed-hook',
            token: cls,
            message: `\`.${cls}\` was removed in catalogue version ${gone.removedIn}${gone.replacedBy ? `; use \`.${gone.replacedBy}\`` : ''}`,
          })
        } else if (cls.startsWith('qt-')) {
          if (!known.has(cls)) reasons.push({ code: 'uncatalogued-qt-class', token: cls, message: `\`.${cls}\` is not a catalogued hook` })
        } else if (!rootClasses.has(cls)) {
          reasons.push({ code: 'non-qt-class', token: cls, message: `\`.${cls}\` is not a \`qt-*\` hook` })
        }
      }
      for (const element of tokens.elements) {
        if (!ALLOWED_ELEMENTS.has(element)) {
          reasons.push({ code: 'bare-element', token: element, message: `bare \`${element}\` matches every one in the app, not a hook` })
        }
      }
      for (const attribute of tokens.attributes) {
        const label = `[${attribute.name}${attribute.operator ?? ''}${attribute.value !== null ? `"${attribute.value}"` : ''}]`
        if (attribute.name === 'class') {
          if (attribute.operator && SUBSTRING_OPERATORS.has(attribute.operator)) {
            reasons.push({ code: 'class-substring', token: label, message: `\`${label}\` matches class-name substrings, which change without notice` })
          } else if (attribute.value) {
            for (const cls of attribute.value.split(/\s+/).filter(Boolean)) {
              if (cls.startsWith('qt-') && !known.has(cls)) {
                reasons.push({ code: 'uncatalogued-qt-class', token: cls, message: `\`${cls}\` is not a catalogued hook` })
              }
            }
          }
          continue
        }
        if (attribute.name === 'style') {
          reasons.push({ code: 'uncatalogued-attribute', token: label, message: `\`${label}\` matches an inline style string, not a hook` })
          continue
        }
        if (attribute.name.startsWith('data-')) {
          if (variantAttributes.has(attribute.name)) {
            const allowed = closed.get(attribute.name)
            if (allowed && attribute.operator === '=' && attribute.value !== null && !allowed.has(attribute.value)) {
              reasons.push({
                code: 'unknown-variant-value',
                token: label,
                message: `\`${attribute.value}\` is not a value of \`${attribute.name}\` (one of: ${[...allowed].join(', ')})`,
              })
            }
          } else if (!ALLOWED_DATA_ATTRIBUTES.has(attribute.name)) {
            reasons.push({ code: 'uncatalogued-attribute', token: label, message: `\`${attribute.name}\` is not set by the app as a hook` })
          }
        }
        // aria-*, role, disabled, type and the like are the element's own
        // semantics, not hooks, and are not flagged.
      }
      if (reasons.length > 0) findings.push({ line, selector: selector.replace(/\s+/g, ' ').trim(), reasons })
    }
  })
  return findings
}
