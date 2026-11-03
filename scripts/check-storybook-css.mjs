#!/usr/bin/env node
/**
 * Lint gate: packages/theme-storybook/src/css/qt-components.css must be exactly
 * what scripts/generate-storybook-css.mjs produces from the app's qt-* layer.
 *
 * The file used to be a hand-maintained, de-Tailwinded mirror and drifted (a
 * third of the app's selectors missing, rules the app had deleted still
 * present). Now it is build output, and this check regenerates it in memory
 * and compares, so a qt-* change that forgets to regenerate fails lint instead
 * of shipping a storybook that disagrees with Quilltap.
 *
 * Run standalone with `node scripts/check-storybook-css.mjs`; `npm run lint`
 * runs it alongside the other repo-wide guards.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateStorybookCss, REGENERATE_COMMAND, STORYBOOK_CSS } from './lib/storybook-css.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let committed
try {
  committed = readFileSync(path.join(REPO_ROOT, STORYBOOK_CSS), 'utf8')
} catch (err) {
  console.error(`check-storybook-css: cannot read ${STORYBOOK_CSS}: ${err.message}`)
  console.error(`Run \`${REGENERATE_COMMAND}\`.`)
  process.exit(1)
}

const expected = await generateStorybookCss(REPO_ROOT)

if (committed === expected) {
  console.log(`check-storybook-css: ${STORYBOOK_CSS} is current.`)
  process.exit(0)
}

const a = committed.split('\n')
const b = expected.split('\n')
let line = 0
while (line < a.length && line < b.length && a[line] === b[line]) line++
console.error(`check-storybook-css: ${STORYBOOK_CSS} is stale (first difference at line ${line + 1}).`)
console.error(`  committed: ${JSON.stringify(a[line] ?? '<end of file>')}`)
console.error(`  expected:  ${JSON.stringify(b[line] ?? '<end of file>')}`)
console.error(`It is generated from app/styles/qt-components/ — never edit it by hand.`)
console.error(`Run \`${REGENERATE_COMMAND}\`.`)
process.exit(1)
