/**
 * check-theme-contrast.ts — the contrast of the default theme and the
 * bundled themes, pair by pair, in light and dark (Calliope Live, Spec D 0.2).
 *
 *   npx tsx scripts/check-theme-contrast.ts            print the table of failures and unchecked pairs
 *   npx tsx scripts/check-theme-contrast.ts --all      print every pair, passes included
 *   npx tsx scripts/check-theme-contrast.ts --check    exit 1 on a failure not on the exception list
 *
 * The exception list is `themes/bundled/contrast-exceptions.json`
 * (`[{ theme, pair, mode, reason }]`); an entry that no longer matches a
 * failure is itself a failure under `--check`, so the list cannot go stale.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { checkContrast, CLIENT_REGISTRY_VIEW, resolveTheme, ThemeTokensDocumentSchema, type ContrastFinding } from '../lib/themes/engine/client'

const root = process.cwd()
const bundledDir = path.join(root, 'themes/bundled')
const exceptionsPath = path.join(bundledDir, 'contrast-exceptions.json')
const all = process.argv.includes('--all')
const check = process.argv.includes('--check')

interface ContrastException {
  theme: string
  pair: string
  mode: 'light' | 'dark'
  reason: string
}

const themes: Array<{ id: string; findings: ContrastFinding[] }> = [
  { id: 'default', findings: checkContrast(resolveTheme({ primitives: {}, tokens: {}, choices: {} }, CLIENT_REGISTRY_VIEW)) },
]
for (const dir of readdirSync(bundledDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
  const manifest = JSON.parse(readFileSync(path.join(bundledDir, dir, 'theme.json'), 'utf8')) as { id: string; tokensPath?: string }
  const tokens = ThemeTokensDocumentSchema.parse(JSON.parse(readFileSync(path.join(bundledDir, dir, manifest.tokensPath ?? 'tokens.json'), 'utf8')))
  themes.push({ id: manifest.id, findings: checkContrast(resolveTheme(tokens, CLIENT_REGISTRY_VIEW)) })
}

const exceptions: ContrastException[] = existsSync(exceptionsPath) ? JSON.parse(readFileSync(exceptionsPath, 'utf8')) : []
const isExcepted = (theme: string, f: ContrastFinding) => exceptions.some((e) => e.theme === theme && e.pair === f.pair.id && e.mode === f.mode)

const rows: string[][] = []
let unexcused = 0
let failed = 0
let unchecked = 0
for (const { id, findings } of themes) {
  for (const f of findings) {
    if (f.status === 'fail') failed++
    if (f.status === 'unchecked') unchecked++
    const excused = f.status === 'fail' && isExcepted(id, f)
    if (f.status === 'fail' && !excused) unexcused++
    if (!all && f.status === 'pass') continue
    rows.push([
      id,
      f.mode,
      f.pair.id,
      f.pair.kind,
      f.ratio !== undefined ? f.ratio.toFixed(2) : '—',
      String(f.threshold),
      f.status === 'fail' && excused ? 'fail (excepted)' : f.status,
      f.status === 'unchecked' ? (f.reason ?? '') : `${f.foreground} on ${f.background}`,
    ])
  }
}

const stale = exceptions.filter((e) => {
  const theme = themes.find((t) => t.id === e.theme)
  return !theme?.findings.some((f) => f.status === 'fail' && f.pair.id === e.pair && f.mode === e.mode)
})

const header = ['theme', 'mode', 'pair', 'kind', 'ratio', 'needs', 'status', 'values']
console.log(`| ${header.join(' | ')} |`)
console.log(`|${header.map(() => '---').join('|')}|`)
for (const r of rows) console.log(`| ${r.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`)
console.log(`\n${themes.length} themes, ${themes[0].findings.length / 2} pairs × 2 modes: ${failed} failed (${failed - unexcused} excepted), ${unchecked} not checked.`)
for (const e of stale) console.log(`stale exception: ${e.theme} ${e.pair} (${e.mode}) no longer fails — remove it from ${path.relative(root, exceptionsPath)}`)

if (check && (unexcused > 0 || stale.length > 0)) {
  console.error(`\ncheck-theme-contrast: ${unexcused} failure(s) not on the exception list, ${stale.length} stale exception(s).`)
  process.exit(1)
}
