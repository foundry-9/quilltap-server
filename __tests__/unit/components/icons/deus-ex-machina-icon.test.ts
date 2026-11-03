/**
 * Guards the `deus-ex-machina` icon wiring for the composer's Deus Ex Machina
 * toggle and armed chip:
 *  - `deus-ex-machina` is a registered icon name (so `<Icon name="deus-ex-machina" />` type-checks).
 *  - the generated default stylesheet carries its mask rule.
 *  - the Madman's Box bundle overrides it with its own glyph, and the file exists.
 */

import { describe, it, expect } from '@jest/globals'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isIconName, ICON_REGISTRY } from '@/components/ui/icons/icon-registry'

describe('deus-ex-machina icon', () => {
  it('is a registered icon name with the default asset', () => {
    expect(isIconName('deus-ex-machina')).toBe(true)
    expect(ICON_REGISTRY['deus-ex-machina']).toEqual({
      defaultFile: '/images/icons/deus-ex-machina.svg',
      defaultMode: 'mask',
    })
    expect(existsSync(join(process.cwd(), 'public', 'images', 'icons', 'deus-ex-machina.svg'))).toBe(true)
  })

  it('has a mask rule in the generated default stylesheet', () => {
    const css = readFileSync(
      join(process.cwd(), 'app', 'styles', 'qt-components', '_icons.css'),
      'utf8',
    )
    expect(css).toMatch(/\[data-icon="deus-ex-machina"\][^\n]*url\("\/images\/icons\/deus-ex-machina\.svg"\)/)
  })

  it('is overridden by the Madman’s Box bundle manifest', () => {
    const themeDir = join(process.cwd(), 'themes', 'bundled', 'madmans-box')
    const manifest = JSON.parse(readFileSync(join(themeDir, 'theme.json'), 'utf8')) as {
      icons?: Record<string, string>
    }
    expect(manifest.icons?.['deus-ex-machina']).toBe('icons/deus-ex-machina.svg')
    expect(existsSync(join(themeDir, 'icons', 'deus-ex-machina.svg'))).toBe(true)
  })
})
