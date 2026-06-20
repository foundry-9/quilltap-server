/**
 * Guards the `mail` icon wiring for the Post Office composer button:
 *  - `mail` is a registered icon name (so `<Icon name="mail" />` type-checks).
 *  - the generated default stylesheet carries the mail mask rule.
 *  - the Madman's Box bundle overrides `mail` with its own glyph.
 */

import { describe, it, expect } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isIconName, ICON_REGISTRY } from '@/components/ui/icons/icon-registry'

describe('mail icon', () => {
  it('is a registered icon name with the default asset', () => {
    expect(isIconName('mail')).toBe(true)
    expect(ICON_REGISTRY.mail).toEqual({ defaultFile: '/images/icons/mail.svg', defaultMode: 'mask' })
  })

  it('has a mask rule in the generated default stylesheet', () => {
    const css = readFileSync(
      join(process.cwd(), 'app', 'styles', 'qt-components', '_icons.css'),
      'utf8',
    )
    expect(css).toMatch(/\[data-icon="mail"\][^\n]*url\("\/images\/icons\/mail\.svg"\)/)
  })

  it('is overridden by the Madman’s Box bundle manifest', () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), 'themes', 'bundled', 'madmans-box', 'theme.json'), 'utf8'),
    ) as { icons?: Record<string, string> }
    expect(manifest.icons?.mail).toBe('icons/mail.svg')
  })
})
