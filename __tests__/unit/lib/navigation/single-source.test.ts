/**
 * The navigation registry is the only list of rail destinations
 * (navigation-menus §9). The rail's components draw from it: none spells a
 * destination's href or a `data-nav` value itself, and no file outside the
 * rail and the specimen gallery draws rail markup.
 */

import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { NAV_ITEMS } from '@/lib/navigation/registry'

const root = process.cwd()
const RAIL_DIR = 'components/layout/left-sidebar/'

function trackedSources(): string[] {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'app', 'components'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(ts|tsx)$/.test(f) && fs.existsSync(path.join(root, f)))
}

// Home's `/` is too common a string to hunt for as a bare literal; its markup form is checked instead.
const destinationHrefs = NAV_ITEMS.flatMap((item) => (item.target.type === 'destination' && item.target.href !== '/' ? [item.target.href] : []))

describe('navigation single source', () => {
  const files = trackedSources()
  const railFiles = files.filter((f) => f.startsWith(RAIL_DIR))

  it('finds the rail', () => {
    expect(railFiles.length).toBeGreaterThan(3)
  })

  it.each(railFiles)('%s spells no destination href and no data-nav value', (file) => {
    const text = fs.readFileSync(path.join(root, file), 'utf8')
    for (const href of destinationHrefs) {
      for (const quote of ["'", '"', '`']) {
        expect(text.includes(`${quote}${href}${quote}`) ? `${file} spells ${href}` : null).toBeNull()
      }
    }
    expect(/\bhref="\/"/.test(text) ? `${file} spells Home's href` : null).toBeNull()
    expect(/data-nav="[^"]*"/.test(text) ? `${file} writes a literal data-nav` : null).toBeNull()
  })

  it('draws rail markup only in the rail and the specimen gallery', () => {
    const railClasses = /\bqt-(collapsed-nav-button|left-sidebar-item|left-sidebar-menu-item)\b/
    const offenders = files
      .filter((f) => !f.startsWith(RAIL_DIR) && !f.startsWith('components/theme-specimens/'))
      .filter((f) => railClasses.test(fs.readFileSync(path.join(root, f), 'utf8')))
    expect(offenders).toEqual([])
  })
})
