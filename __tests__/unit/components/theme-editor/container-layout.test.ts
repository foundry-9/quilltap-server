/**
 * @jest-environment node
 *
 * The theme editor lays out by the width of its pane, not of the window
 * (Calliope Live, Spec I decision 4): a split pane in a wide window must not
 * get the wide layout. So no viewport breakpoint (`sm:`, `md:`, `lg:`, `xl:`,
 * `2xl:`, or their `max-` forms) may appear in `components/theme-editor/`;
 * container variants (`@lg:` and the like) are the way.
 */

import fs from 'fs'
import path from 'path'

const ROOT = path.join(process.cwd(), 'components', 'theme-editor')
const VIEWPORT_VARIANT = /(?<![@\w-])(?:max-)?(?:sm|md|lg|xl|2xl):[a-z-[]/g

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sources(full)
    return /\.(tsx?|css)$/.test(entry.name) ? [full] : []
  })
}

describe('theme editor layout', () => {
  it('uses no viewport breakpoint', () => {
    const offenders: string[] = []
    for (const file of sources(ROOT)) {
      const text = fs.readFileSync(file, 'utf8')
      for (const match of text.matchAll(VIEWPORT_VARIANT)) {
        offenders.push(`${path.relative(process.cwd(), file)}: ${match[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('would catch one', () => {
    expect('grid md:grid-cols-2'.match(VIEWPORT_VARIANT)).not.toBeNull()
    expect('grid @md:grid-cols-2 @3xl:hidden'.match(VIEWPORT_VARIANT)).toBeNull()
  })
})
