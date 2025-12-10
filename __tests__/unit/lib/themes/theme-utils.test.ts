import {
  themeTokensToCSS,
  themeColorsToCSS,
  themeTokensToStyleObject,
  mergeThemeTokens,
  mergeWithDefaultTheme,
  colorPalettesEqual,
  themeTokensEqual,
  getThemeDifferences,
  generateFontFaceRule,
  generateFontFacesCSS,
} from '@/lib/themes/utils'
import { DEFAULT_THEME_TOKENS, getDefaultThemeTokens } from '@/lib/themes/default-tokens'

describe('theme utility helpers', () => {
  it('generates CSS for light/dark modes with typography, spacing, and effects', () => {
    const css = themeTokensToCSS(DEFAULT_THEME_TOKENS)
    expect(css).toContain(':root')
    expect(css).toContain('.dark')
    expect(css).toContain('--theme-background')
    expect(css).toContain('--theme-font-sans')
  })

  it('generates CSS variable snippets and style objects for a specific color mode', () => {
    const snippet = themeColorsToCSS(DEFAULT_THEME_TOKENS, 'dark')
    expect(snippet).toContain('--theme-background')

    const style = themeTokensToStyleObject(DEFAULT_THEME_TOKENS, 'light')
    expect(style['--theme-primary']).toBe(DEFAULT_THEME_TOKENS.colors.light.primary)
    expect(style['--theme-font-sans']).toBe(DEFAULT_THEME_TOKENS.typography?.fontSans)
  })

  it('merges partial overrides and preserves defaults', () => {
    const base = getDefaultThemeTokens()
    const merged = mergeThemeTokens(base, {
      colors: { light: { primary: '#000000' } },
      typography: { fontSans: 'Custom Sans' },
      spacing: { spacing1: '0.125rem' },
      effects: { shadowSm: '0 0 1px #000' },
    })

    expect(merged.colors.light.primary).toBe('#000000')
    expect(merged.colors.dark.primary).toBe(base.colors.dark.primary)
    expect(merged.typography?.fontSans).toBe('Custom Sans')
    expect(merged.spacing?.spacing1).toBe('0.125rem')
    expect(merged.effects?.shadowSm).toBe('0 0 1px #000')

    const withDefaults = mergeWithDefaultTheme({ colors: { dark: { background: '#111111' } } })
    expect(withDefaults.colors.light.background).toBe(base.colors.light.background)
    expect(withDefaults.colors.dark.background).toBe('#111111')
  })

  it('compares palettes and entire theme tokens', () => {
    const base = getDefaultThemeTokens()
    const modified = getDefaultThemeTokens()
    modified.colors.light.primary = '#123456'

    expect(colorPalettesEqual(base.colors.light, modified.colors.light)).toBe(false)
    expect(themeTokensEqual(base, base)).toBe(true)
    expect(themeTokensEqual(base, modified)).toBe(false)
  })

  it('reports detailed differences between themes', () => {
    const base = getDefaultThemeTokens()
    const compare = mergeThemeTokens(base, {
      colors: { light: { background: '#111111' } },
      typography: { fontSans: 'Custom' },
      spacing: { spacing2: '0.6rem' },
      effects: { shadowSm: '0 0 1px #000' },
    })

    const diff = getThemeDifferences(base, compare)
    expect(diff.lightColors).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'background', compare: '#111111' }),
    ]))
    expect(diff.typography).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'fontSans', compare: 'Custom' }),
    ]))
    expect(diff.spacing).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'spacing2', compare: '0.6rem' }),
    ]))
    expect(diff.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'shadowSm', compare: '0 0 1px #000' }),
    ]))
  })

  it('generates @font-face rules for theme fonts', () => {
    const rule = generateFontFaceRule({ family: 'Atlas', src: '/fonts/atlas.woff2', weight: '700', style: 'italic' })
    expect(rule).toContain('@font-face')
    expect(rule).toContain('font-family: "Atlas"')
    expect(rule).toContain('format("woff2")')

    const bundle = generateFontFacesCSS([
      { family: 'Atlas', src: '/fonts/atlas.woff2' },
      { family: 'Nova', src: '/fonts/nova.ttf', display: 'swap' },
    ])
    expect(bundle.split('@font-face').length - 1).toBe(2)
  })
})
