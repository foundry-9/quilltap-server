#!/usr/bin/env node
/**
 * Repo-wide guard against `qt-*` classes that resolve to nothing.
 *
 * A CSS class that does not exist is indistinguishable, at every automated
 * layer we have, from one that exists and happens to inherit: the markup
 * renders, TypeScript is satisfied, ESLint has no opinion, and jsdom does no
 * cascade. Only a person looking at a real browser can tell, and only if the
 * missing colour happens to be far from the inherited one. That is how bug 39
 * (`qt-text-danger`), bug 100 (`qt-text-*-foreground`) and bug 102 (most of the
 * `hover:qt-bg-*` family) each survived for months.
 *
 * Two shapes recur, and this script fails the build on both:
 *
 *  1. A base utility nobody defined — usually the Tailwind name with a `qt-`
 *     bolted on (`qt-text-destructive-foreground`), or an opacity step the
 *     sheet never grew (`qt-bg-muted/50`).
 *  2. A variant form of a real utility. Tailwind generates variants only for
 *     utilities it knows about, and a class declared inside `@layer utilities`
 *     is invisible to it — so `hover:qt-bg-muted` is not "qt-bg-muted, on
 *     hover", it is an undefined class name. Every state form has to be written
 *     out by hand in `_utilities.css`, escaped, with its own pseudo-selector.
 *
 *  3. A bare component class nobody defined (`qt-button-danger` for
 *     `qt-button-destructive`, `qt-input-sm` before it existed). In
 *     `app/` and `components/` markup, every `qt-*` class must be defined by
 *     the app's CSS (a `::highlight(qt-…)` name counts), be a catalogued theme
 *     hook or state class (`lib/themes/hooks/` — those may exist purely for
 *     themes to target), or be one of the MARKERS below, each with its reason.
 *     A marker that is no longer written, or has since been defined or
 *     catalogued, fails too, so the list cannot rot.
 *
 * SCOPE. Rules 1 and 2 cover the four *utility* families — `qt-bg-`,
 * `qt-text-`, `qt-border-`, `qt-shadow-` — plus any `qt-*` token carrying a
 * variant prefix, whatever its family, across the repo's source. Rule 3 covers
 * bare classes in `app/` and `components/` (tests and stories aside). A name
 * built from a template literal (`qt-foo-${kind}`) is not a whole class name
 * and is not checked.
 *
 * Escape hatch: a line containing `qt-class-exception` is skipped.
 *
 * Needs the hook catalogue (TypeScript), so it runs under tsx:
 * `npx tsx scripts/check-qt-classes.mjs`; `npm run lint` runs it alongside the
 * other repo-wide guards.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HOOK_CATALOGUE } from '../lib/themes/hooks/index.ts'
import { catalogueClassNames } from '../lib/themes/hooks/lint.ts'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Families whose bare (variant-free) names must resolve. */
const GUARDED_FAMILIES = /^qt-(bg|text|border|shadow)-/

/** Source trees whose className strings the app is responsible for. */
const SOURCE_GLOBS = ['*.tsx', '*.ts', '*.jsx']
const SKIPPED_PREFIXES = ['packages/', 'plugins/', 'scripts/', 'node_modules/']

/**
 * A class token as it appears in markup: an optional chain of variant prefixes
 * (`hover:`, `focus:`, `group-hover/thumb:`) followed by the `qt-` name, which
 * may carry an opacity modifier (`/50`).
 */
const TOKEN = /((?:[a-z][a-z0-9-]*(?:\/[a-z0-9-]+)?:)*)(qt-[a-z0-9-]+(?:\/[0-9]+)?)/g

/**
 * The same thing as a CSS selector, where every `:` and `/` is backslashed.
 * Matched loosely on purpose: we only care that the class name appears at the
 * head of some selector, not what follows it.
 */
const SELECTOR = /\.((?:[a-z][a-z0-9-]*(?:\\\/[a-z0-9-]+)?\\:)*qt-[a-z0-9-]+(?:\\\/[0-9]+)?)/g

/**
 * Bare classes the markup writes on purpose with no rule of their own: anchors
 * for a parent's selector or a test, the base of a family whose members carry
 * the look, and names a library or stored data hands us. Each needs a reason.
 */
const MARKERS = {
  'qt-atlas-tab': 'tab anchor in the item control dialog; the look is qt-tab',
  'qt-inventory-tab': 'tab anchor in the item control dialog; the look is qt-tab',
  'qt-wardrobe-tab': 'tab anchor in the item control dialog; the look is qt-tab',
  'qt-chat-concepts-group': 'grouping wrapper; its label and list carry the look',
  'qt-chat-sidebar-cards': 'participant card list wrapper, laid out by utilities',
  'qt-chat-sidebar-section': 'sidebar section anchor (base of the -<name> markers)',
  'qt-chat-sidebar-section-chat': 'sidebar section anchor for themes and tests',
  'qt-chat-sidebar-section-edit': 'sidebar section anchor for themes and tests',
  'qt-chat-sidebar-section-organize': 'sidebar section anchor for themes and tests',
  'qt-chat-sidebar-section-participants': 'sidebar section anchor for themes and tests',
  'qt-chat-sidebar-section-visibility': 'sidebar section anchor for themes and tests',
  'qt-chat-speaker-selector': 'anchor for the speaker selector, laid out by utilities',
  'qt-chat-user-turn-banner': 'anchor for the your-turn banner, laid out by utilities',
  'qt-chat-system-bar-chevron-down': 'direction marker on the system bar chevron',
  'qt-chat-thinking-label': 'text anchor inside the styled reasoning summary',
  'qt-confirmation-badge-label': 'text anchor inside the styled confirmation badge',
  'qt-courier-bubble-attachments': 'wrapper; its label and list carry the look',
  'qt-courier-bubble-paste': 'wrapper; its label and textarea carry the look',
  'qt-participant-status-select': 'anchor on a qt-select',
  'qt-speaking-as-avatar': 'anchor on the composer avatar, laid out by utilities',
  'qt-doc-pane-inner': 'inner wrapper of a styled pane, laid out by utilities',
  'qt-doc-vertical-pane-top': 'position marker on a styled qt-doc-vertical-pane',
  'qt-doc-vertical-pane-bottom': 'position marker on a styled qt-doc-vertical-pane',
  'qt-code-editor-tooltip-line': 'one message line inside the styled tooltip',
  'qt-mention-typeahead-listbox': 'anchor on the mention menu (styled as qt-typeahead-menu)',
  'qt-diagram-lightbox-root': 'portal root for the diagram lightbox',
  'qt-qtap-doc': 'base of qt-qtap-doc--inert; a live link is styled as a link',
  'qt-lexical-token': 'base of the Lexical code-highlight token map; each kind carries the colour',
  'qt-mermaid': 'class mermaid gives the SVG it renders',
  'qt-roleplay-plain': 'the "no style" value stored in roleplay templates',
  'qt-style-options-unmarked': 'roleplay template editor: the "unmarked" option anchor',
}

/** A whole class name in markup: not a custom property, not a template-literal prefix. */
const BARE = /(?<![\w:/-])(qt-[a-z0-9]+(?:--?[a-z0-9]+)*)(-?\$\{|-\*|-(?![a-z0-9-]))?/g

/** `::highlight(qt-…)` names are defined by CSS too. */
const HIGHLIGHT = /::highlight\((qt-[a-z0-9-]+)\)/g

function tracked(globs) {
  return execFileSync('git', ['ls-files', ...globs], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
}

/** Every `qt-*` class the app's own stylesheets define. */
function definedClasses() {
  const defined = new Set()
  for (const file of tracked(['*.css']).filter((f) => f.startsWith('app/'))) {
    const css = readFileSync(path.join(REPO_ROOT, file), 'utf8')
    for (const match of css.matchAll(SELECTOR)) {
      defined.add(match[1].replaceAll('\\', ''))
    }
    for (const match of css.matchAll(HIGHLIGHT)) defined.add(match[1])
  }
  return defined
}

/** Every guarded `qt-*` token the app's markup reaches for, with its sites. */
function usedClasses() {
  const used = new Map()
  for (const file of tracked(SOURCE_GLOBS)) {
    if (SKIPPED_PREFIXES.some((p) => file.startsWith(p))) continue
    const source = readFileSync(path.join(REPO_ROOT, file), 'utf8')
    source.split('\n').forEach((line, i) => {
      if (line.includes('qt-class-exception')) return
      // `--qt-foo` is a custom property, not a class.
      for (const match of line.replaceAll(/--qt-[a-z0-9-]+/g, '').matchAll(TOKEN)) {
        const [token, variants, base] = match
        if (!variants && !GUARDED_FAMILIES.test(base)) continue
        if (!used.has(token)) used.set(token, [])
        used.get(token).push(`${file}:${i + 1}`)
      }
    })
  }
  return used
}

/** Rule 3: every bare `qt-*` class in app markup, with its sites. */
function bareClasses() {
  const used = new Map()
  for (const file of tracked(['app', 'components'])) {
    if (!/\.(tsx?|jsx)$/.test(file)) continue
    if (/(^|\/)__tests__\//.test(file) || /\.(test|spec|stories)\.[jt]sx?$/.test(file)) continue
    const source = readFileSync(path.join(REPO_ROOT, file), 'utf8')
    source.split('\n').forEach((line, i) => {
      if (line.includes('qt-class-exception')) return
      for (const match of line.replaceAll(/--qt-[a-z0-9-]+/g, '').matchAll(BARE)) {
        if (match[2]) continue // a prefix: qt-foo-${…}, qt-foo-*, qt-foo- at a line end
        if (!used.has(match[1])) used.set(match[1], [])
        used.get(match[1]).push(`${file}:${i + 1}`)
      }
    })
  }
  return used
}

const defined = definedClasses()
const catalogued = catalogueClassNames(HOOK_CATALOGUE)
const missing = [...usedClasses().entries()]
  .filter(([token]) => !defined.has(token))
  .sort((a, b) => b[1].length - a[1].length)

const bare = bareClasses()
const undefinedBare = [...bare.entries()]
  .filter(([name]) => !defined.has(name) && !catalogued.has(name) && !(name in MARKERS))
  .sort((a, b) => b[1].length - a[1].length)
const staleMarkers = Object.keys(MARKERS).filter((name) => !bare.has(name) || defined.has(name) || catalogued.has(name))

if (undefinedBare.length > 0) {
  const total = undefinedBare.reduce((n, [, sites]) => n + sites.length, 0)
  console.error(
    `\ncheck-qt-classes: ${undefinedBare.length} bare qt-* class(es) in app markup, used in ${total} place(s),\n` +
      `are defined by no CSS, catalogued as no theme hook, and listed as no marker.\n` +
      `Use a class that exists, define it in app/styles/qt-components/, or — if it is an\n` +
      `anchor with no look of its own — add it to MARKERS in scripts/check-qt-classes.mjs\n` +
      `with its reason.\n`
  )
  for (const [name, sites] of undefinedBare) {
    console.error(`  ${name}`)
    for (const site of sites.slice(0, 5)) console.error(`      ${site}`)
    if (sites.length > 5) console.error(`      … and ${sites.length - 5} more`)
  }
}
if (staleMarkers.length > 0) {
  console.error('\ncheck-qt-classes: MARKERS entries that no longer hold — remove them:')
  for (const name of staleMarkers) {
    const why = !bare.has(name) ? 'not written in app markup any more' : defined.has(name) ? 'now defined in CSS' : 'now a catalogued theme hook'
    console.error(`  ${name} (${why})`)
  }
}

if (missing.length === 0) {
  if (undefinedBare.length > 0 || staleMarkers.length > 0) process.exit(1)
  console.log(
    `check-qt-classes: ${defined.size} qt-* classes defined, every guarded reference resolves; ` +
      `${bare.size} bare classes in app markup, each defined, catalogued or one of ${Object.keys(MARKERS).length} markers.`
  )
  process.exit(0)
}

const total = missing.reduce((n, [, sites]) => n + sites.length, 0)
console.error(
  `\ncheck-qt-classes: ${missing.length} qt-* class name(s) used in ${total} place(s) resolve to no CSS rule.\n` +
    `These render as nothing at all — no error, no warning, just an element that keeps\n` +
    `whatever it inherited. Define them in app/styles/qt-components/_utilities.css (and\n` +
    `mirror into packages/theme-storybook), or change the markup to a class that exists.\n` +
    `A variant form (hover:, focus:, disabled:, …) needs its own hand-written escaped\n` +
    `selector — Tailwind generates none for classes declared in @layer utilities.\n`
)
for (const [token, sites] of missing) {
  console.error(`  ${token}`)
  for (const site of sites.slice(0, 5)) console.error(`      ${site}`)
  if (sites.length > 5) console.error(`      … and ${sites.length - 5} more`)
}
console.error('')
process.exit(1)
