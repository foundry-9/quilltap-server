/**
 * Compiles the app's qt-* component layer to plain CSS, in memory.
 *
 * The app's families (`app/styles/qt-components/*.css`, in `_index.css`
 * order) are written with Tailwind `@apply`. This module runs them through
 * Tailwind's own compiler (`@tailwindcss/node`'s `compile`, the engine under
 * `@tailwindcss/postcss`) against the same token map the app uses
 * (`app/styles/theme-tokens.css`), with `@reference "tailwindcss"` so
 * Tailwind's theme and utilities are available to `@apply` without being
 * emitted, and no candidates scanned from markup. The result is what the app
 * compiles for these rules — including Tailwind v4's `@media (hover: hover)`
 * wrap on `hover:` — then autoprefixed like the app's PostCSS pipeline.
 *
 * The one consumer is Calliope's styled-by table
 * (`scripts/lib/styled-by-sources.ts`): with every `@apply` expanded, each
 * rule's declarations can be read directly. Compare
 * `scripts/lib/compile-app-css.mjs`, which compiles the whole app stylesheet
 * *with* the markup scan — a different question.
 *
 * Pure with respect to its inputs: same files in, same text out. Plain Node
 * only: `@tailwindcss/node` registers module hooks that Jest's loader
 * refuses, so tests run it in a child process.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

/** Repo-relative paths. */
export const QT_COMPONENTS_DIR = 'app/styles/qt-components'
export const QT_COMPONENTS_INDEX = `${QT_COMPONENTS_DIR}/_index.css`
export const THEME_TOKENS = 'app/styles/theme-tokens.css'

const IMPORT_LINE = /^@import\s+"\.\/([^"]+)";/gm

function log(debug, ...args) {
  if (debug) console.error('[qt-components-css]', ...args)
}

/** The family files `_index.css` imports, in order. */
export function listFamilies(root) {
  const index = readFileSync(path.join(root, QT_COMPONENTS_INDEX), 'utf8')
  const families = [...index.matchAll(IMPORT_LINE)].map((m) => m[1])
  if (families.length === 0) {
    throw new Error(`No @import lines found in ${QT_COMPONENTS_INDEX}`)
  }
  return families
}

/**
 * The virtual entry: Tailwind for `@apply` resolution only, the shared token
 * map, then each family's source inlined in order.
 */
export function buildEntry(root) {
  const parts = ['@reference "tailwindcss";', `@import "./${THEME_TOKENS}";`, '']
  for (const file of listFamilies(root)) {
    parts.push(readFileSync(path.join(root, QT_COMPONENTS_DIR, file), 'utf8'))
  }
  return parts.join('\n') + '\n'
}

/**
 * Compile a CSS entry with Tailwind (no candidates — only `@apply` and the
 * at-rules need expanding) and autoprefix it. Exported so the unit test can
 * pin the compiler's output shape on a small fixture.
 */
export async function compileEntry(entry, { base, debug = false } = {}) {
  // Resolve from the repo being compiled, not from wherever this module sits.
  const require = createRequire(path.join(base, 'package.json'))
  const { compile } = require('@tailwindcss/node')
  const postcss = require('postcss')
  const autoprefixer = require('autoprefixer')

  const deps = []
  const compiler = await compile(entry, { base, onDependency: (d) => deps.push(d) })
  log(debug, `compiled entry; ${deps.length} dependencies`)
  const css = compiler.build([])

  // `from` inside the repo so autoprefixer reads the same browserslist config
  // (or default) the app's PostCSS run does.
  const result = await postcss([autoprefixer()]).process(css, {
    from: path.join(base, 'app/globals.css'),
    map: false,
  })
  for (const w of result.warnings()) log(debug, `postcss warning: ${w.toString()}`)
  return result.css
}

/**
 * The compiled qt-* layer, as a string.
 * @param {string} root repo root
 */
export async function compileQtComponentsCss(root, { debug = false } = {}) {
  const entry = buildEntry(root)
  log(debug, `entry: ${entry.length} bytes`)
  const css = await compileEntry(entry, { base: root, debug })
  log(debug, `compiled ${css.length} bytes`)
  return css
}
