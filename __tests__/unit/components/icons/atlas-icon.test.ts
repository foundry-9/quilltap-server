/**
 * Guards the `atlas` icon wiring for the Atlas's buttons, rows and tab:
 *  - `atlas` is a registered icon name (so `<Icon name="atlas" />` type-checks).
 *  - its default asset exists and is a currentColor-stroked 24×24 glyph, like its neighbours.
 *  - the generated default stylesheet carries the atlas mask rule.
 *  - the Atlas workspace tab wears it.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isIconName, ICON_REGISTRY } from '@/components/ui/icons/icon-registry'
import { DEFAULT_TAB_META } from '@/lib/workspace/tab-meta'

describe('atlas icon', () => {
  it('is a registered icon name with the default asset', () => {
    expect(isIconName('atlas')).toBe(true)
    expect(ICON_REGISTRY.atlas).toEqual({ defaultFile: '/images/icons/atlas.svg', defaultMode: 'mask' })
  })

  it('ships a mask-ready SVG in the neighbours’ style', () => {
    const path = join(process.cwd(), 'public', 'images', 'icons', 'atlas.svg')
    expect(existsSync(path)).toBe(true)
    const svg = readFileSync(path, 'utf8')
    expect(svg).toContain('viewBox="0 0 24 24"')
    expect(svg).toContain('stroke="currentColor"')
    expect(svg).toContain('stroke-width="2"')
  })

  it('has a mask rule in the generated default stylesheet', () => {
    const css = readFileSync(join(process.cwd(), 'app', 'styles', 'qt-components', '_icons.css'), 'utf8')
    expect(css).toMatch(/\[data-icon="atlas"\][^\n]*url\("\/images\/icons\/atlas\.svg"\)/)
  })

  it('is the Atlas workspace tab icon', () => {
    expect(DEFAULT_TAB_META.atlas).toEqual({ title: 'The Atlas', icon: 'atlas' })
  })
})
