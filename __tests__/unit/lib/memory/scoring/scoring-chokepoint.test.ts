/**
 * @jest-environment node
 *
 * Every worth-ordering in the memory system goes through `salience` or
 * `protection` (memory refactor §3.4, §5 invariant 5). The floored
 * `effectiveWeight` that once leaked into ranking at four call sites is gone;
 * this test keeps it gone: no source file outside `lib/memory/scoring/`
 * mentions it, nor the deleted modules that computed it.
 */

import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const SCAN_DIRS = ['lib', 'app', 'components', 'hooks', 'migrations', 'packages/quilltap/lib', 'packages/quilltap/bin']
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs'])
const ALLOWED_DIR = path.join('lib', 'memory', 'scoring') + path.sep

const FORBIDDEN = [
  /\beffectiveWeight\b/,
  /\bcalculateEffectiveWeight\b/,
  /\brankMemoriesByWeight\b/,
  /memory-weighting/,
  /memory\/reinforced-importance['"]/,
]

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (EXTENSIONS.has(path.extname(entry.name))) out.push(full)
  }
}

describe('scoring chokepoint', () => {
  it('no source file outside lib/memory/scoring/ computes or names the floored weight', () => {
    const files: string[] = []
    for (const dir of SCAN_DIRS) walk(path.join(ROOT, dir), files)
    expect(files.length).toBeGreaterThan(100)

    const offenders: string[] = []
    for (const file of files) {
      const rel = path.relative(ROOT, file)
      if (rel.startsWith(ALLOWED_DIR)) continue
      const text = fs.readFileSync(file, 'utf8')
      for (const pattern of FORBIDDEN) {
        if (pattern.test(text)) offenders.push(`${rel}: ${pattern}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
