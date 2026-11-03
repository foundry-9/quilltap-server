/**
 * Compiles the app's qt-* component layer into the plain CSS shipped by
 * @quilltap/theme-storybook (`packages/theme-storybook/src/css/qt-components.css`).
 *
 * The app's families (`app/styles/qt-components/*.css`) are written with
 * Tailwind `@apply`. This module runs them through Tailwind's own compiler
 * (`@tailwindcss/node`'s `compile`, the engine under `@tailwindcss/postcss`)
 * against the same token map the app uses (`app/styles/theme-tokens.css`),
 * with `@reference "tailwindcss"` so Tailwind's theme and utilities are
 * available to `@apply` without being emitted. The result is what the app
 * compiles for these rules — including Tailwind v4's `@media (hover: hover)`
 * wrap on `hover:` — then autoprefixed like the app's PostCSS pipeline.
 *
 * Comments. Tailwind drops ordinary comments, hoists `/*! … *\/` ones to the
 * top of the file, drops unknown at-rules and merges same-named `@layer`
 * blocks, so no comment survives in place on its own. To keep the family and
 * section banners a theme author reads the file by, each family is inlined
 * (in `_index.css` order) and every *statement-level* comment — at top level
 * or directly inside a top-level `@layer` — becomes a marker rule
 * (`.__qtsb-N { --qtsb: N; }`) that compiles through untouched and is swapped
 * back into the original comment afterwards. Comments inside a rule body are
 * dropped, as Tailwind would.
 *
 * Pure with respect to its inputs: same files in, same bytes out. Shared by
 * scripts/generate-storybook-css.mjs (writes the file) and
 * scripts/check-storybook-css.mjs (the lint gate).
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

/** Repo-relative paths. */
export const QT_COMPONENTS_DIR = 'app/styles/qt-components'
export const QT_COMPONENTS_INDEX = `${QT_COMPONENTS_DIR}/_index.css`
export const THEME_TOKENS = 'app/styles/theme-tokens.css'
export const STORYBOOK_CSS = 'packages/theme-storybook/src/css/qt-components.css'
export const REGENERATE_COMMAND = 'npm run generate:storybook-css'

/** Layer order the app gets from `@import "tailwindcss"` (properties is hoisted first). */
const LAYER_ORDER = '@layer properties, theme, base, components, utilities;'

const IMPORT_LINE = /^@import\s+"\.\/([^"]+)";[ \t]*(?:\/\*\s*([\s\S]*?)\s*\*\/)?/gm
const MARKER_CLASS = '__qtsb-'
const MARKER_RULE = /^([ \t]*)\.__qtsb-(\d+) \{\s*--qtsb: \2;\s*\}/gm

function log(debug, ...args) {
  if (debug) console.error('[storybook-css]', ...args)
}

/**
 * Read `_index.css` and list the family files it imports, in order, with the
 * one-line description from its trailing comment.
 */
export function listFamilies(root) {
  const index = readFileSync(path.join(root, QT_COMPONENTS_INDEX), 'utf8')
  const families = []
  for (const m of index.matchAll(IMPORT_LINE)) {
    families.push({ file: m[1], description: (m[2] ?? '').replace(/\s+/g, ' ') })
  }
  if (families.length === 0) {
    throw new Error(`No @import lines found in ${QT_COMPONENTS_INDEX}`)
  }
  return families
}

/**
 * Replace statement-level comments in `css` with marker rules, recording each
 * comment (`{ text, col }`) in `comments` at the marker's index. A comment is
 * statement-level when it sits at brace depth 0, or at depth 1 directly inside
 * a top-level `@layer`. A depth-0 comment followed by a `@layer … {` is moved
 * just inside that block, so it stays beside the rules it introduces when
 * Tailwind merges the layer with earlier ones.
 *
 * `leading` (optional) is an extra comment to place before the first statement.
 */
export function markComments(css, comments, leading) {
  let out = ''
  let depth = 0
  /** Stack of booleans: is the open block at this depth a top-level @layer? */
  const layerStack = []
  /** Depth-0 comments waiting for the next statement. */
  let pending = leading ? [{ text: leading, col: 0 }] : []
  let stmtStart = true // at the start of a statement (only whitespace since the last ; { })
  let i = 0

  const marker = (comment) => {
    comments.push(comment)
    const n = comments.length - 1
    return `.${MARKER_CLASS}${n} { --qtsb: ${n}; }\n`
  }
  const flushPending = () => {
    const s = pending.map(marker).join('')
    pending = []
    return s
  }

  while (i < css.length) {
    const ch = css[i]
    const next = css[i + 1]

    if (ch === '/' && next === '*') {
      const end = css.indexOf('*/', i + 2)
      const stop = end < 0 ? css.length : end + 2
      const col = i - (css.lastIndexOf('\n', i - 1) + 1)
      const text = { text: css.slice(i, stop), col }
      const inLayerBody = depth === 1 && layerStack[0] === true
      if (stmtStart && depth === 0) {
        pending.push(text)
      } else if (stmtStart && inLayerBody) {
        out += marker(text)
      }
      i = stop
      continue
    }

    if (ch === '"' || ch === "'") {
      let j = i + 1
      while (j < css.length && css[j] !== ch) j += css[j] === '\\' ? 2 : 1
      out += css.slice(i, j + 1)
      i = j + 1
      stmtStart = false
      continue
    }

    if (/\s/.test(ch)) {
      out += ch
      i++
      continue
    }

    if (stmtStart && depth === 0 && pending.length > 0) {
      // Attach pending top-level comments to this statement.
      const isLayerBlock = /^@layer\s+[\w-]+\s*\{/.test(css.slice(i, i + 200))
      if (!isLayerBlock) out += flushPending()
    }

    if (ch === '{') {
      const isLayer = depth === 0 && /@layer\s+[\w-]+\s*$/.test(lastStatement(out))
      layerStack[depth] = isLayer
      depth++
      out += ch
      if (isLayer && pending.length > 0) out += '\n' + flushPending()
      stmtStart = true
      i++
      continue
    }
    if (ch === '}') {
      depth = Math.max(0, depth - 1)
      out += ch
      stmtStart = true
      i++
      continue
    }
    if (ch === ';') {
      out += ch
      stmtStart = true
      i++
      continue
    }

    out += ch
    stmtStart = false
    i++
  }
  out += flushPending()
  return out
}

/** The text since the last statement boundary in `s`. */
function lastStatement(s) {
  const cut = Math.max(s.lastIndexOf(';'), s.lastIndexOf('{'), s.lastIndexOf('}'))
  return s.slice(cut + 1)
}

/**
 * The virtual entry: Tailwind for `@apply` resolution only, the shared token
 * map, then each family's source inlined with its comments marked.
 * Returns the entry and the comment table the markers index into.
 */
export function buildEntry(root) {
  const comments = []
  const parts = ['@reference "tailwindcss";', `@import "./${THEME_TOKENS}";`, '']
  for (const { file, description } of listFamilies(root)) {
    const rel = `${QT_COMPONENTS_DIR}/${file}`
    const source = readFileSync(path.join(root, rel), 'utf8')
    const label = description ? `${rel} — ${description}` : rel
    const bannerText = `/* ${'='.repeat(74)}\n   SOURCE: ${label.replace(/\*\//g, '* /')}\n   ${'='.repeat(74)} */`
    parts.push(markComments(source, comments, bannerText))
  }
  return { entry: parts.join('\n') + '\n', comments }
}

/**
 * Re-indent a comment to `indent`. `col` is the column its `/*` stood at in
 * the source, so continuation lines keep their alignment relative to it.
 */
function reindent({ text, col }, indent) {
  const [first, ...rest] = text.split('\n')
  const moved = rest.map((line) => {
    if (!line.trim()) return ''
    const lead = line.match(/^[ \t]*/)[0].length
    return indent + line.slice(Math.min(lead, col))
  })
  return [indent + first, ...moved].join('\n')
}

/** Swap marker rules back into the comments they stand for. */
export function restoreComments(css, comments) {
  return css.replace(MARKER_RULE, (_m, indent, n) => {
    const comment = comments[Number(n)]
    if (comment === undefined) throw new Error(`Unknown comment marker ${n}`)
    return reindent(comment, indent)
  })
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

/** Header prepended to the generated file. */
export function header() {
  return [
    '/**',
    ' * Quilltap Component Classes (qt-*) — GENERATED FILE, DO NOT EDIT.',
    ' *',
    ` * Source of truth: ${QT_COMPONENTS_DIR}/ (via _index.css), compiled with`,
    ` * Tailwind against ${THEME_TOKENS} by scripts/generate-storybook-css.mjs.`,
    ` * Regenerate with: ${REGENERATE_COMMAND}`,
    ' * `npm run lint` fails when this file is stale.',
    ' *',
    ' * Every Tailwind @apply in the app source is expanded here to plain CSS. The',
    ' * rules sit in @layer components / utilities exactly as in the app, so any',
    ' * unlayered theme CSS overrides them. Token values come from --theme-* and',
    ' * --color-* custom properties (see quilltap-defaults.css). Comments inside',
    ' * rule bodies are not carried over; read the app source for those.',
    ' *',
    ' * @package @quilltap/theme-storybook',
    ' */',
    LAYER_ORDER,
    '',
  ].join('\n')
}

/**
 * The full generated file, as a string.
 * @param {string} root repo root
 */
export async function generateStorybookCss(root, { debug = false } = {}) {
  const { entry, comments } = buildEntry(root)
  log(debug, `entry: ${entry.length} bytes, ${comments.length} comments marked`)
  const compiled = await compileEntry(entry, { base: root, debug })
  const body = restoreComments(compiled, comments)
  if (body.includes(MARKER_CLASS)) {
    throw new Error('A comment marker survived compilation unrestored; the compiler output shape changed.')
  }
  const out = header() + body.replace(/^\s+/, '').replace(/\s*$/, '\n')
  log(debug, `generated ${out.length} bytes`)
  return out
}
