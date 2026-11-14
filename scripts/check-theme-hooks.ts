/**
 * check-theme-hooks.ts — the theme hook catalogue gate, run by `npm run lint`.
 *
 * Fails on:
 *  1. a malformed catalogue (`lib/themes/hooks/`);
 *  2. a catalogued hook, state class or variant attribute no longer in the
 *     markup (`.ts` / `.tsx` under `app/` and `components/`);
 *  3. a literal variant value in TSX that the catalogue does not list;
 *  4. a stale `docs/developer/THEME_HOOKS.md`.
 *
 * Then reports, WITHOUT failing, what each bundled theme's `styles.css`
 * targets that is not a hook (Spec C's worklist; it becomes a gate there).
 * Pass `--verbose` to list every finding.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { HOOK_CATALOGUE } from '../lib/themes/hooks'
import { renderThemeHooksDoc, THEME_HOOKS_DOC_PATH } from '../lib/themes/hooks/doc'
import { lintCatalogue, lintMarkup, lintThemeSelectors, type SourceFile } from '../lib/themes/hooks/lint'

const root = process.cwd()
const verbose = process.argv.includes('--verbose')

function markupFiles(): SourceFile[] {
  const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'app', 'components'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return listed
    .split('\n')
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .filter((file) => !/(^|\/)__tests__\//.test(file) && !/\.(test|spec|stories)\.tsx?$/.test(file))
    .filter((file) => existsSync(path.join(root, file)))
    .map((file) => ({ path: file, content: readFileSync(path.join(root, file), 'utf8') }))
}

const failures = [...lintCatalogue(HOOK_CATALOGUE), ...lintMarkup(HOOK_CATALOGUE, markupFiles())]

const docPath = path.join(root, THEME_HOOKS_DOC_PATH)
const expectedDoc = renderThemeHooksDoc(HOOK_CATALOGUE)
if (!existsSync(docPath) || readFileSync(docPath, 'utf8') !== expectedDoc) {
  failures.push({
    rule: 'catalogue',
    message: `${THEME_HOOKS_DOC_PATH} is stale: run \`npm run generate:theme-hooks-doc\``,
  })
}

// ---- Report-only: bundled theme selectors ---------------------------------
const themesDir = path.join(root, 'themes', 'bundled')
const themeIds = existsSync(themesDir)
  ? readdirSync(themesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
  : []
const totals = new Map<string, number>()
console.log('Theme selectors off the hook catalogue (report only — Spec C makes this a gate):')
for (const id of themeIds) {
  const cssPath = path.join(themesDir, id, 'styles.css')
  if (!existsSync(cssPath)) continue
  const findings = lintThemeSelectors(readFileSync(cssPath, 'utf8'), HOOK_CATALOGUE)
  const byCode = new Map<string, number>()
  for (const finding of findings) {
    for (const reason of finding.reasons) {
      byCode.set(reason.code, (byCode.get(reason.code) ?? 0) + 1)
      totals.set(reason.code, (totals.get(reason.code) ?? 0) + 1)
    }
  }
  const summary = [...byCode.entries()].map(([code, n]) => `${code} ${n}`).join(', ') || 'clean'
  console.log(`  ${id}: ${findings.length} selectors — ${summary}`)
  if (verbose) {
    for (const finding of findings) {
      console.log(`    styles.css:${finding.line}  ${finding.selector}`)
      for (const reason of finding.reasons) console.log(`      - ${reason.code}: ${reason.message}`)
    }
  }
}
if (totals.size > 0) {
  console.log(`  total: ${[...totals.entries()].map(([code, n]) => `${code} ${n}`).join(', ')}`)
}

if (failures.length > 0) {
  console.error(`\nTheme hook catalogue check failed (${failures.length}):`)
  for (const issue of failures) {
    const where = issue.file ? `${issue.file}${issue.line ? `:${issue.line}` : ''}: ` : ''
    console.error(`  [${issue.rule}] ${where}${issue.message}`)
  }
  process.exit(1)
}
console.log(`Theme hook catalogue: ${HOOK_CATALOGUE.hooks.length} hooks, version ${HOOK_CATALOGUE.version}, markup in step.`)
