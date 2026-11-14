/**
 * Every `/settings` address in the help documents must land on a real group
 * or card. A wrong settings URL is invisible to every other check — this is
 * the gate (settings-redesign §1.4, §7).
 */

import fs from 'fs'
import path from 'path'
import { isSettingsPersona, resolveSettingsHref } from '@/lib/settings/registry'

/** A persona lens or a pre-filled search is a whole-page address, not a group or card. */
function resolvesToPage(url: string): boolean {
  if (resolveSettingsHref(url)) return true
  const params = new URLSearchParams(url.split('?')[1] ?? '')
  return isSettingsPersona(params.get('persona')) || !!params.get('q')?.trim()
}

const HELP_DIR = path.join(process.cwd(), 'help')
const docs = fs.readdirSync(HELP_DIR).filter((f) => f.endsWith('.md'))

function settingsAddresses(text: string): string[] {
  const found: string[] = []
  const frontmatter = /^url:\s*(\/settings\S*)\s*$/m.exec(text)
  if (frontmatter) found.push(frontmatter[1])
  for (const m of text.matchAll(/help_navigate\(url:\s*"(\/settings[^"]*)"\)/g)) found.push(m[1])
  for (const m of text.matchAll(/\]\((\/settings(?:\?[^)\s]*)?)\)/g)) found.push(m[1])
  for (const m of text.matchAll(/`(\/settings\?[^`\s]*)`/g)) found.push(m[1])
  return found
}

describe('help documents’ settings links', () => {
  const cases = docs.flatMap((doc) =>
    settingsAddresses(fs.readFileSync(path.join(HELP_DIR, doc), 'utf8'))
      .filter((url) => url !== '/settings' && !url.startsWith('/settings/'))
      .map((url) => [doc, url] as const),
  )

  it('finds the links it is meant to check', () => {
    expect(cases.length).toBeGreaterThan(50)
  })

  it.each(cases)('%s → %s resolves', (_doc, url) => {
    expect(resolvesToPage(url)).toBe(true)
  })

  it.each(cases)('%s → %s uses the current address form', (_doc, url) => {
    expect(url).not.toMatch(/[?&]tab=/)
  })

  it('keeps every doc’s url frontmatter and help_navigate call in step', () => {
    for (const doc of docs) {
      const text = fs.readFileSync(path.join(HELP_DIR, doc), 'utf8')
      const url = /^url:\s*(\S+)\s*$/m.exec(text)?.[1]
      if (!url?.startsWith('/settings')) continue
      const navigations = [...text.matchAll(/help_navigate\(url:\s*"([^"]*)"\)/g)].map((m) => m[1])
      expect({ doc, matches: navigations.includes(url) }).toEqual({ doc, matches: true })
    }
  })
})
