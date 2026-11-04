/**
 * The character-kind chokepoint fence.
 *
 * A character's kind (roleplay / assistant) is read and compared only in
 * `lib/characters/kind.ts`. Everywhere else asks `resolveCharacterKind` or
 * `isAssistantCharacter`. A hand comparison against a kind literal is how a
 * default drifts: one site treats an absent value as roleplay, another as
 * assistant, and a third kind is missed in half the places that branch.
 *
 * @jest-environment node
 */

import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const SCAN_DIRS = ['lib', 'app', 'components', 'hooks']
const CHOKEPOINT = 'lib/characters/kind.ts'

/** `kind === 'assistant'`, `'roleplay' !== x.kind`, and so on. */
const KIND_COMPARISON =
  /\bkind\s*[!=]==?\s*['"](?:roleplay|assistant)['"]|['"](?:roleplay|assistant)['"]\s*[!=]==?\s*[\w.?]*\bkind\b/

function walk(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
}

describe('character kind chokepoint', () => {
  it('compares a kind literal only in lib/characters/kind.ts', () => {
    const files: string[] = []
    for (const dir of SCAN_DIRS) walk(path.join(ROOT, dir), files)

    const offenders: string[] = []
    for (const file of files) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/')
      if (rel === CHOKEPOINT) continue
      const lines = fs.readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (KIND_COMPARISON.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`)
      })
    }

    expect(offenders).toEqual([])
  })

  it('the fence pattern catches the comparisons it is meant to', () => {
    expect(KIND_COMPARISON.test("if (character.kind === 'assistant') {")).toBe(true)
    expect(KIND_COMPARISON.test("c.kind !== 'roleplay'")).toBe(true)
    expect(KIND_COMPARISON.test("'assistant' === character?.kind")).toBe(true)
    expect(KIND_COMPARISON.test("descriptor.kind === 'markdown'")).toBe(false)
    expect(KIND_COMPARISON.test("message.role === 'assistant'")).toBe(false)
  })
})
