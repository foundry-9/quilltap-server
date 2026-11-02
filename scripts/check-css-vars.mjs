#!/usr/bin/env node
/**
 * Repo-wide guard against CSS custom properties that resolve to nothing.
 *
 * A `var(--name)` whose property is defined nowhere, and which carries no
 * valid fallback, makes its whole declaration invalid at computed-value time.
 * The browser then quietly uses the inherited or initial value instead: the
 * rule looks right in the source, every check passes, and the colour (or the
 * focus ring, or the border) simply never appears. That is how the help dialog
 * and the Document Mode chrome spent months painting with shadcn-style names
 * (`hsl(var(--primary))`, `var(--qt-border)`) that this app has never defined.
 *
 * The rule this script enforces, for every `var()` in `app/**\/*.css`:
 *
 *  - the property is defined somewhere we can see — a `--name:` declaration in
 *    the app's CSS or a bundled theme's CSS, a key the theme loader maps tokens
 *    onto (`lib/themes/`, the theme style injector), a property set at runtime
 *    from TypeScript (`'--name'` as a string literal), or one of Tailwind's own
 *    built-ins; or
 *  - it is a per-theme hook, `var(--hook, <fallback>)`, whose fallback itself
 *    resolves by the same rule (recursively — a fallback of `hsl(var(--x))`
 *    with `--x` undefined is still nothing).
 *
 * Fallbacks are checked even when the property is defined: a fallback that
 * names nothing is a safety net with a hole in it.
 *
 * It also rejects `hsl(var(--color-*))` / `hsl(var(--theme-*))`: those tokens
 * already hold complete `hsl(...)` values, so wrapping them again is invalid.
 *
 * Escape hatch: a line containing `css-var-exception` is skipped.
 *
 * Run standalone with `node scripts/check-css-vars.mjs`; `npm run lint` runs
 * it alongside the other repo-wide guards.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Tailwind v4 emits these itself; they are never declared in our sources. */
const TAILWIND_BUILTINS = new Set(['--spacing'])
const TAILWIND_PREFIXES = ['--tw-']

/** Tokens that already hold a complete colour value. */
const COMPLETE_COLOUR_TOKEN = /\bhsla?\(\s*var\(\s*--(color|theme)-/

function tracked(args) {
  return execFileSync('git', ['ls-files', ...args], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
}

/** Replace comments with blanks, keeping newlines so line numbers survive. */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
}

function definedProperties() {
  const defined = new Set(TAILWIND_BUILTINS)

  const cssSources = tracked(['*.css']).filter(
    (f) => f.startsWith('app/') || f.startsWith('themes/'),
  )
  for (const file of cssSources) {
    const css = stripComments(readFileSync(path.join(REPO_ROOT, file), 'utf8'))
    for (const m of css.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) defined.add(m[1])
  }

  // Properties named as string literals in TypeScript: the theme loader's
  // token map, the injector, and inline `style={{ '--x': … }}` / setProperty.
  const tsSources = tracked(['*.ts', '*.tsx']).filter(
    (f) => !/^(packages|plugins|node_modules|scripts)\//.test(f) && !f.includes('__tests__'),
  )
  for (const file of tsSources) {
    const src = readFileSync(path.join(REPO_ROOT, file), 'utf8')
    for (const m of src.matchAll(/['"`](--[A-Za-z0-9_-]+)['"`]/g)) defined.add(m[1])
    // Template-built names (`--theme-${key}`) are covered by the CSS side:
    // every such family is also declared with defaults in globals.css.
  }

  return defined
}

function isDefined(name, defined) {
  return defined.has(name) || TAILWIND_PREFIXES.some((p) => name.startsWith(p))
}

/** Index of the `)` that closes the `(` at `open`, or -1. */
function closingParen(text, open) {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')' && --depth === 0) return i
  }
  return -1
}

/** Index of the first comma at depth 0 in `text`, or -1. */
function topLevelComma(text) {
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') depth--
    else if (text[i] === ',' && depth === 0) return i
  }
  return -1
}

/**
 * Every unresolvable `var()` in `text`, as `{ name, offset }`. A `var()` whose
 * property is undefined fails unless its fallback is non-empty and resolves.
 */
function unresolved(text, defined, base = 0) {
  const failures = []
  const re = /var\(\s*/g
  let m
  while ((m = re.exec(text))) {
    const open = m.index + 3
    const close = closingParen(text, open)
    if (close === -1) break
    const inner = text.slice(open + 1, close)
    const comma = topLevelComma(inner)
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim()
    const fallback = comma === -1 ? null : inner.slice(comma + 1)

    // A fallback is checked even when the property is defined: a fallback
    // naming nothing is dead code that looks like a safety net.
    const nested =
      fallback === null ? [] : unresolved(fallback, defined, base + open + 1 + comma + 1)
    if (!isDefined(name, defined)) {
      if (fallback === null || fallback.trim() === '') {
        failures.push({ name, offset: base + m.index })
      } else if (nested.length > 0) {
        failures.push({ name, offset: base + m.index, nested })
      }
    } else if (nested.length > 0) {
      failures.push({ name, offset: base + m.index, nested, definedName: true })
    }
    re.lastIndex = close + 1
  }
  return failures
}

function lineOf(text, offset) {
  let line = 1
  for (let i = 0; i < offset; i++) if (text[i] === '\n') line++
  return line
}

function describe(failure) {
  if (!failure.nested) return `${failure.name} (undefined, no fallback)`
  if (failure.definedName) {
    return `${failure.name} (fallback ${failure.nested.map(describe).join(', ')})`
  }
  return `${failure.name} (undefined; fallback ${failure.nested.map(describe).join(', ')})`
}

function main() {
  const defined = definedProperties()
  const problems = []

  for (const file of tracked(['app/*.css', 'app/**/*.css'])) {
    const raw = readFileSync(path.join(REPO_ROOT, file), 'utf8')
    const rawLines = raw.split('\n')
    const css = stripComments(raw)
    const skip = (line) => rawLines[line - 1]?.includes('css-var-exception')

    for (const failure of unresolved(css, defined)) {
      const line = lineOf(css, failure.offset)
      if (!skip(line)) problems.push(`${file}:${line}  ${describe(failure)}`)
    }

    css.split('\n').forEach((text, i) => {
      if (COMPLETE_COLOUR_TOKEN.test(text) && !skip(i + 1)) {
        problems.push(
          `${file}:${i + 1}  hsl() wrapped around a --color-*/--theme-* token, which is already a full colour`,
        )
      }
    })
  }

  if (problems.length > 0) {
    console.error(
      `\nUndefined CSS custom properties (${problems.length}). Point each at a real token ` +
        '(`--color-*`, a `--qt-*` variable from _variables.css) or give the hook a valid fallback:\n',
    )
    for (const p of problems) console.error(`  ${p}`)
    console.error('')
    process.exit(1)
  }
}

main()
