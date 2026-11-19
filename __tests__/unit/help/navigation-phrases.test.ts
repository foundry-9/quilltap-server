/**
 * Every "open **Group** and choose **Item**" in the help documents names a
 * menu and a row that exist in the navigation registry — the way
 * settings-links.test.ts holds settings links to the settings registry
 * (navigation-menus §8, §9).
 */

import fs from 'fs'
import path from 'path'
import { NAV_GROUPS } from '@/lib/navigation/registry'

const HELP_DIR = path.join(process.cwd(), 'help')
const docs = fs.readdirSync(HELP_DIR).filter((f) => f.endsWith('.md'))

/** "open **X** and choose **Y**", any case on the verbs, across a line break. */
const PHRASE = /\bopen\s+\*\*([^*]+)\*\*\s+and\s+choose\s+\*\*([^*]+)\*\*/gi

const groups = new Map<string, readonly string[]>(NAV_GROUPS.map((g) => [g.label, g.items.map((i) => i.label)]))

const cases = docs.flatMap((doc) =>
  Array.from(fs.readFileSync(path.join(HELP_DIR, doc), 'utf8').matchAll(PHRASE)).map(
    (m) => [doc, m[1].trim(), m[2].trim()] as const,
  ),
)

describe('help documents’ rail directions', () => {
  it('finds the directions it is meant to check', () => {
    expect(cases.length).toBeGreaterThanOrEqual(10)
  })

  it.each(cases)('%s: open %s and choose %s', (_doc, group, item) => {
    expect(groups.has(group) ? group : `no menu named ${group}`).toBe(group)
    expect(groups.get(group)).toContain(item)
  })

  it('has a navigation page that names every menu and row', () => {
    const text = fs.readFileSync(path.join(HELP_DIR, 'navigation.md'), 'utf8')
    for (const group of NAV_GROUPS) {
      expect(text).toContain(`### ${group.label}`)
      for (const item of group.items) expect(text).toContain(`**${item.label}**`)
    }
  })
})
