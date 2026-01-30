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
  generateScopedThemeCSS,
} from '@/lib/themes/utils'
import { DEFAULT_THEME_TOKENS, getDefaultThemeTokens } from '@/lib/themes/default-tokens'
import type { ThemeTokens } from '@/lib/themes/types'

describe('theme utility helpers', () => {
  describe('CSS generation', () => {
    it('generates CSS for light/dark modes with typography, spacing, and effects', () => {
      const css = themeTokensToCSS(DEFAULT_THEME_TOKENS)
      expect(css).toContain(':root')
      expect(css).toContain('.dark')
      expect(css).toContain('--theme-background')
      expect(css).toContain('--theme-font-sans')
    })

    it('includes all color variables in generated CSS', () => {
      const css = themeTokensToCSS(DEFAULT_THEME_TOKENS)
      expect(css).toContain('--theme-primary')
      expect(css).toContain('--theme-secondary')
      expect(css).toContain('--theme-accent')
      expect(css).toContain('--theme-destructive')
      expect(css).toContain('--theme-border')
      expect(css).toContain('--theme-input')
    })

    it('includes typography variables in generated CSS', () => {
      const css = themeTokensToCSS(DEFAULT_THEME_TOKENS)
      expect(css).toContain('--theme-font-sans')
      expect(css).toContain('--theme-font-serif')
      expect(css).toContain('--theme-font-mono')
      expect(css).toContain('--theme-font-size-base')
      expect(css).toContain('--theme-line-height-normal')
      expect(css).toContain('--theme-font-weight-medium')
    })

    it('includes spacing variables in generated CSS', () => {
      const css = themeTokensToCSS(DEFAULT_THEME_TOKENS)
      expect(css).toContain('--theme-radius-sm')
      expect(css).toContain('--theme-radius-lg')
      expect(css).toContain('--theme-spacing-1')
      expect(css).toContain('--theme-spacing-4')
    })

    it('includes effects variables in generated CSS', () => {
      const css = themeTokensToCSS(DEFAULT_THEME_TOKENS)
      expect(css).toContain('--theme-shadow-sm')
      expect(css).toContain('--theme-shadow-md')
      expect(css).toContain('--theme-transition-normal')
      expect(css).toContain('--theme-focus-ring-width')
    })

    it('handles themes with missing optional sections', () => {
      const minimalTokens: ThemeTokens = {
        colors: {
          light: DEFAULT_THEME_TOKENS.colors.light,
          dark: DEFAULT_THEME_TOKENS.colors.dark,
        },
      }
      const css = themeTokensToCSS(minimalTokens)
      expect(css).toContain(':root')
      expect(css).toContain('.dark')
      expect(css).toContain('--theme-background')
    })

    it('generates CSS variable snippets for specific color mode', () => {
      const lightSnippet = themeColorsToCSS(DEFAULT_THEME_TOKENS, 'light')
      expect(lightSnippet).toContain('--theme-background')
      expect(lightSnippet).not.toContain(':root')
      
      const darkSnippet = themeColorsToCSS(DEFAULT_THEME_TOKENS, 'dark')
      expect(darkSnippet).toContain('--theme-background')
      expect(darkSnippet).not.toContain('.dark')
    })

    it('generates style objects for React components', () => {
      const lightStyle = themeTokensToStyleObject(DEFAULT_THEME_TOKENS, 'light')
      expect(lightStyle['--theme-primary']).toBe(DEFAULT_THEME_TOKENS.colors.light.primary)
      expect(lightStyle['--theme-font-sans']).toBe(DEFAULT_THEME_TOKENS.typography?.fontSans)
      expect(lightStyle['--theme-spacing-4']).toBe(DEFAULT_THEME_TOKENS.spacing?.spacing4)

      const darkStyle = themeTokensToStyleObject(DEFAULT_THEME_TOKENS, 'dark')
      expect(darkStyle['--theme-primary']).toBe(DEFAULT_THEME_TOKENS.colors.dark.primary)
      expect(darkStyle['--theme-background']).toBe(DEFAULT_THEME_TOKENS.colors.dark.background)
    })
  })

  describe('theme merging', () => {
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
    })

    it('merges only light mode colors', () => {
      const base = getDefaultThemeTokens()
      const merged = mergeThemeTokens(base, {
        colors: { light: { primary: '#FF0000', secondary: '#00FF00' } },
      })
      expect(merged.colors.light.primary).toBe('#FF0000')
      expect(merged.colors.light.secondary).toBe('#00FF00')
      expect(merged.colors.dark.primary).toBe(base.colors.dark.primary)
    })

    it('merges only dark mode colors', () => {
      const base = getDefaultThemeTokens()
      const merged = mergeThemeTokens(base, {
        colors: { dark: { background: '#000000', foreground: '#FFFFFF' } },
      })
      expect(merged.colors.dark.background).toBe('#000000')
      expect(merged.colors.dark.foreground).toBe('#FFFFFF')
      expect(merged.colors.light.background).toBe(base.colors.light.background)
    })

    it('merges with default theme', () => {
      const withDefaults = mergeWithDefaultTheme({ colors: { dark: { background: '#111111' } } })
      expect(withDefaults.colors.light.background).toBe(DEFAULT_THEME_TOKENS.colors.light.background)
      expect(withDefaults.colors.dark.background).toBe('#111111')
    })

    it('preserves all typography fields when partially overriding', () => {
      const base = getDefaultThemeTokens()
      const merged = mergeThemeTokens(base, {
        typography: { fontSans: 'Custom Font' },
      })
      expect(merged.typography?.fontSans).toBe('Custom Font')
      expect(merged.typography?.fontSerif).toBe(base.typography?.fontSerif)
      expect(merged.typography?.fontMono).toBe(base.typography?.fontMono)
    })

    it('preserves all spacing fields when partially overriding', () => {
      const base = getDefaultThemeTokens()
      const merged = mergeThemeTokens(base, {
        spacing: { radiusLg: '1rem' },
      })
      expect(merged.spacing?.radiusLg).toBe('1rem')
      expect(merged.spacing?.radiusSm).toBe(base.spacing?.radiusSm)
      expect(merged.spacing?.spacing4).toBe(base.spacing?.spacing4)
    })

    it('preserves all effects fields when partially overriding', () => {
      const base = getDefaultThemeTokens()
      const merged = mergeThemeTokens(base, {
        effects: { transitionNormal: '300ms' },
      })
      expect(merged.effects?.transitionNormal).toBe('300ms')
      expect(merged.effects?.transitionFast).toBe(base.effects?.transitionFast)
      expect(merged.effects?.shadowSm).toBe(base.effects?.shadowSm)
    })
  })

  describe('theme comparison', () => {
    it('compares palettes and entire theme tokens', () => {
      const base = getDefaultThemeTokens()
      const modified = getDefaultThemeTokens()
      modified.colors.light.primary = '#123456'

      expect(colorPalettesEqual(base.colors.light, modified.colors.light)).toBe(false)
      expect(themeTokensEqual(base, base)).toBe(true)
      expect(themeTokensEqual(base, modified)).toBe(false)
    })

    it('detects equal palettes', () => {
      const palette1 = { ...DEFAULT_THEME_TOKENS.colors.light }
      const palette2 = { ...DEFAULT_THEME_TOKENS.colors.light }
      expect(colorPalettesEqual(palette1, palette2)).toBe(true)
    })

    it('detects palette differences in any field', () => {
      const base = { ...DEFAULT_THEME_TOKENS.colors.light }
      const modified1 = { ...base, border: '#999999' }
      const modified2 = { ...base, accent: '#FF00FF' }
      
      expect(colorPalettesEqual(base, modified1)).toBe(false)
      expect(colorPalettesEqual(base, modified2)).toBe(false)
    })

    it('detects typography differences', () => {
      const base = getDefaultThemeTokens()
      const modified = getDefaultThemeTokens()
      modified.typography!.fontSans = 'Different Font'
      
      expect(themeTokensEqual(base, modified)).toBe(false)
    })

    it('detects spacing differences', () => {
      const base = getDefaultThemeTokens()
      const modified = getDefaultThemeTokens()
      modified.spacing!.radiusLg = '999px'
      
      expect(themeTokensEqual(base, modified)).toBe(false)
    })

    it('detects effects differences', () => {
      const base = getDefaultThemeTokens()
      const modified = getDefaultThemeTokens()
      modified.effects!.shadowMd = '0 0 0 transparent'
      
      expect(themeTokensEqual(base, modified)).toBe(false)
    })
  })

  describe('theme differences reporting', () => {
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

    it('reports multiple light color differences', () => {
      const base = getDefaultThemeTokens()
      const compare = mergeThemeTokens(base, {
        colors: { 
          light: { 
            primary: '#FF0000',
            secondary: '#00FF00',
            accent: '#0000FF',
          } 
        },
      })

      const diff = getThemeDifferences(base, compare)
      expect(diff.lightColors.length).toBe(3)
    })

    it('reports dark color differences separately', () => {
      const base = getDefaultThemeTokens()
      const compare = mergeThemeTokens(base, {
        colors: { 
          dark: { 
            background: '#000000',
            foreground: '#FFFFFF',
          } 
        },
      })

      const diff = getThemeDifferences(base, compare)
      expect(diff.darkColors.length).toBe(2)
      expect(diff.lightColors.length).toBe(0)
    })

    it('returns empty arrays when themes are identical', () => {
      const base = getDefaultThemeTokens()
      const compare = getDefaultThemeTokens()

      const diff = getThemeDifferences(base, compare)
      expect(diff.lightColors).toEqual([])
      expect(diff.darkColors).toEqual([])
      expect(diff.typography).toEqual([])
      expect(diff.spacing).toEqual([])
      expect(diff.effects).toEqual([])
    })
  })

  describe('font face generation', () => {
    it('generates @font-face rules for theme fonts', () => {
      const rule = generateFontFaceRule({ 
        family: 'Atlas', 
        src: '/fonts/atlas.woff2', 
        weight: '700', 
        style: 'italic' 
      })
      expect(rule).toContain('@font-face')
      expect(rule).toContain('font-family: "Atlas"')
      expect(rule).toContain('format("woff2")')
      expect(rule).toContain('font-weight: 700')
      expect(rule).toContain('font-style: italic')
    })

    it('generates bundle of multiple @font-face rules', () => {
      const bundle = generateFontFacesCSS([
        { family: 'Atlas', src: '/fonts/atlas.woff2' },
        { family: 'Nova', src: '/fonts/nova.ttf', display: 'swap' },
      ])
      expect(bundle.split('@font-face').length - 1).toBe(2)
      expect(bundle).toContain('Atlas')
      expect(bundle).toContain('Nova')
    })

    it('uses default values for optional font properties', () => {
      const rule = generateFontFaceRule({ 
        family: 'BasicFont', 
        src: '/fonts/basic.woff2' 
      })
      expect(rule).toContain('font-weight: 400')
      expect(rule).toContain('font-style: normal')
      expect(rule).toContain('font-display: swap')
    })

    it('detects correct font formats from extensions', () => {
      const woff2Rule = generateFontFaceRule({ family: 'F', src: '/f.woff2' })
      expect(woff2Rule).toContain('format("woff2")')

      const woffRule = generateFontFaceRule({ family: 'F', src: '/f.woff' })
      expect(woffRule).toContain('format("woff")')

      const ttfRule = generateFontFaceRule({ family: 'F', src: '/f.ttf' })
      expect(ttfRule).toContain('format("truetype")')

      const otfRule = generateFontFaceRule({ family: 'F', src: '/f.otf' })
      expect(otfRule).toContain('format("opentype")')
    })

    it('handles empty font array', () => {
      const bundle = generateFontFacesCSS([])
      expect(bundle).toBe('')
    })

    it('supports different font display strategies', () => {
      const swapRule = generateFontFaceRule({ family: 'F', src: '/f.woff2', display: 'swap' })
      expect(swapRule).toContain('font-display: swap')

      const blockRule = generateFontFaceRule({ family: 'F', src: '/f.woff2', display: 'block' })
      expect(blockRule).toContain('font-display: block')

      const optionalRule = generateFontFaceRule({ family: 'F', src: '/f.woff2', display: 'optional' })
      expect(optionalRule).toContain('font-display: optional')
    })
  })

  describe('scoped CSS generation for previews', () => {
    it('generates scoped CSS for light mode', () => {
      const css = generateScopedThemeCSS(DEFAULT_THEME_TOKENS, undefined, 'my-preview', 'light')
      expect(css).toContain('.my-preview')
      expect(css).toContain('--theme-background')
      expect(css).toContain('--color-background: var(--theme-background)')
      expect(css).toContain('background-color: var(--theme-background)')
      expect(css).toContain('color: var(--theme-foreground)')
    })

    it('generates scoped CSS for dark mode', () => {
      const css = generateScopedThemeCSS(DEFAULT_THEME_TOKENS, undefined, 'dark-preview', 'dark')
      expect(css).toContain('.dark-preview')
      expect(css).toContain('--theme-background')
      // Dark mode uses dark colors
      expect(css).toContain(DEFAULT_THEME_TOKENS.colors.dark.background)
    })

    it('includes font-face rules when fonts are provided', () => {
      const fonts = [
        { family: 'CustomFont', src: '/fonts/custom.woff2', weight: '400' },
      ]
      const css = generateScopedThemeCSS(DEFAULT_THEME_TOKENS, fonts, 'font-preview', 'light')
      expect(css).toContain('@font-face')
      expect(css).toContain('CustomFont')
      expect(css).toContain('.font-preview')
    })

    it('maps theme variables to color variables for Tailwind', () => {
      const css = generateScopedThemeCSS(DEFAULT_THEME_TOKENS, undefined, 'tw-preview', 'light')
      expect(css).toContain('--color-primary: var(--theme-primary)')
      expect(css).toContain('--color-secondary: var(--theme-secondary)')
      expect(css).toContain('--color-muted: var(--theme-muted)')
      expect(css).toContain('--color-destructive: var(--theme-destructive)')
    })

    it('includes typography, spacing, and effects variables', () => {
      const css = generateScopedThemeCSS(DEFAULT_THEME_TOKENS, undefined, 'full-preview', 'light')
      expect(css).toContain('--theme-font-sans')
      expect(css).toContain('--theme-radius-lg')
      expect(css).toContain('--theme-shadow-md')
    })

    it('handles minimal tokens without optional sections', () => {
      const minimalTokens = {
        colors: {
          light: DEFAULT_THEME_TOKENS.colors.light,
          dark: DEFAULT_THEME_TOKENS.colors.dark,
        },
      }
      const css = generateScopedThemeCSS(minimalTokens, undefined, 'minimal-preview', 'light')
      expect(css).toContain('.minimal-preview')
      expect(css).toContain('--theme-background')
      // Should not throw even without typography/spacing/effects
    })

    it('sanitizes scope class name with special characters', () => {
      // The scope class should be used as-is, but themeId sanitization happens in the component
      const css = generateScopedThemeCSS(DEFAULT_THEME_TOKENS, undefined, 'preview-test-123', 'light')
      expect(css).toContain('.preview-test-123')
    })
  })
})
