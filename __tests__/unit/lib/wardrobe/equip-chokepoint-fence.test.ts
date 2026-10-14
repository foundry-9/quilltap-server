/**
 * The wear ledger's chokepoint fence.
 *
 * `chats.setEquippedOutfit` is the physical slot write; every "put something
 * on" path must reach it through `wardrobeWear.commitEquippedOutfit`, which
 * diffs against the prior slots and credits the wears. A direct caller would
 * dress a character without the ledger ever hearing of it. The only
 * sanctioned caller is the chokepoint itself.
 *
 * @jest-environment node
 */

import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const SCAN_DIRS = ['lib', 'app']
const SANCTIONED = new Set([
  // The definition.
  'lib/database/repositories/chats.repository.ts',
  // The chokepoint.
  'lib/database/repositories/wardrobe-wear.repository.ts',
])

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
}

describe('equip chokepoint fence', () => {
  it('no code outside the chokepoint calls setEquippedOutfit(', () => {
    const files: string[] = []
    for (const dir of SCAN_DIRS) walk(path.join(ROOT, dir), files)

    const offenders = files
      .map((file) => path.relative(ROOT, file).split(path.sep).join('/'))
      .filter((rel) => !SANCTIONED.has(rel))
      .filter((rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').includes('setEquippedOutfit('))

    expect(offenders).toEqual([])
  })

  it('the chokepoint is a buffered write in the job child', () => {
    const proxy = fs.readFileSync(
      path.join(ROOT, 'lib/background-jobs/child/child-repositories-proxy.ts'),
      'utf8',
    )
    expect(proxy).toMatch(/'wardrobeWear\.commitEquippedOutfit':\s*'write'/)
  })
})
