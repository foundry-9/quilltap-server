#!/usr/bin/env node
/**
 * Writes packages/theme-storybook/src/css/qt-components.css from the app's
 * qt-* component layer (app/styles/qt-components/). That file is build output:
 * never edit it by hand; change the app source and run
 * `npm run generate:storybook-css`. `npm run lint` fails when it is stale
 * (scripts/check-storybook-css.mjs).
 *
 * Usage:
 *   node scripts/generate-storybook-css.mjs            # write the package file
 *   node scripts/generate-storybook-css.mjs --out x.css  # write elsewhere
 *   node scripts/generate-storybook-css.mjs --debug    # log the entry and steps
 */

import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateStorybookCss, STORYBOOK_CSS } from './lib/storybook-css.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const outIdx = args.indexOf('--out')
const outPath = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : path.join(REPO_ROOT, STORYBOOK_CSS)
const debug = args.includes('--debug')

const css = await generateStorybookCss(REPO_ROOT, { debug })
writeFileSync(outPath, css)
console.log(`Wrote ${path.relative(process.cwd(), outPath) || outPath} (${css.split('\n').length} lines)`)
