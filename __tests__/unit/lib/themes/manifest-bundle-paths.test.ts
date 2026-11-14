/**
 * @jest-environment node
 *
 * Theme manifest fields that name files inside the bundle (`stylesPath`,
 * `tokensPath`, `previewImage`, `fonts[].src`, `icons`) must be relative
 * paths with no `..` segment, whichever separator is used.
 */

import { isBundleRelativePath, QtapThemeManifestSchema } from '@/lib/themes/types'

const BASE = {
  format: 'qtap-theme',
  formatVersion: 1,
  id: 'sample',
  name: 'Sample',
  version: '1.0.0',
  author: 'Someone',
  tokensPath: 'tokens.json',
}

describe('isBundleRelativePath', () => {
  it.each(['styles.css', 'fonts/A.woff2', './icons/x.svg', 'a..b/c.css', '..hidden/x'])('accepts %s', (p) => {
    expect(isBundleRelativePath(p)).toBe(true)
  })

  it.each(['', '/etc/passwd', '\\\\server\\share', 'C:\\x.css', 'c:x', '../x.css', 'a/../../x', 'a\\..\\x', 'x/..', 'a\0b'])(
    'refuses %p',
    (p) => {
      expect(isBundleRelativePath(p)).toBe(false)
    }
  )
})

describe('QtapThemeManifestSchema', () => {
  it('accepts a manifest with bundle-relative paths', () => {
    const result = QtapThemeManifestSchema.safeParse({
      ...BASE,
      stylesPath: 'styles.css',
      previewImage: 'preview.webp',
      fonts: [{ family: 'A', src: 'fonts/A.woff2' }],
      icons: { close: 'icons/close.svg' },
    })
    expect(result.success).toBe(true)
  })

  it.each([
    ['stylesPath', { stylesPath: '../../../etc/passwd' }],
    ['tokensPath', { tokensPath: '/etc/passwd' }],
    ['previewImage', { previewImage: '..\\..\\secret.png' }],
    ['fonts[].src', { fonts: [{ family: 'A', src: '../outside.woff2' }] }],
    ['icons', { icons: { close: '../../x.svg' } }],
  ])('refuses an escaping %s', (_field, patch) => {
    expect(QtapThemeManifestSchema.safeParse({ ...BASE, ...patch }).success).toBe(false)
  })
})
