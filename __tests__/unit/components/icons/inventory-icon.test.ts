/**
 * Guards the `inventory` icon wiring for the Inventory's buttons and tab:
 *  - `inventory` is a registered icon name (so `<Icon name="inventory" />` type-checks).
 *  - the generated default stylesheet carries the inventory mask rule.
 *  - the Madman's Box bundle overrides `inventory` with its own glyph.
 *  - the Inventory workspace tab wears it rather than Pascal's `dice`.
 */

import { describe, it, expect } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isIconName, ICON_REGISTRY } from '@/components/ui/icons/icon-registry'
import { DEFAULT_TAB_META } from '@/lib/workspace/tab-meta'

describe('inventory icon', () => {
  it('is a registered icon name with the default asset', () => {
    expect(isIconName('inventory')).toBe(true)
    expect(ICON_REGISTRY.inventory).toEqual({ defaultFile: '/images/icons/inventory.svg', defaultMode: 'mask' })
  })

  it('has a mask rule in the generated default stylesheet', () => {
    const css = readFileSync(
      join(process.cwd(), 'app', 'styles', 'qt-components', '_icons.css'),
      'utf8',
    )
    expect(css).toMatch(/\[data-icon="inventory"\][^\n]*url\("\/images\/icons\/inventory\.svg"\)/)
  })

  it('is overridden by the Madman’s Box bundle manifest', () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), 'themes', 'bundled', 'madmans-box', 'theme.json'), 'utf8'),
    ) as { icons?: Record<string, string> }
    expect(manifest.icons?.inventory).toBe('icons/inventory.svg')
  })

  it('is the Inventory workspace tab icon', () => {
    expect(DEFAULT_TAB_META.inventory.icon).toBe('inventory')
  })
})
