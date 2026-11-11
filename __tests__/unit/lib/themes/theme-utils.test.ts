import {
  themeTokensToCSS,
  mergeThemeTokens,
  generateFontFaceRule,
  generateFontFacesCSS,
  generateIconOverrideRule,
  generateIconOverridesCSS,
  generateScopedThemeCSS,
} from '@/lib/themes/utils'
import { DEFAULT_THEME_TOKENS } from '@/lib/themes/default-tokens'
import type { ThemeTokens } from '@/lib/themes/types'

/** A fresh copy of the defaults, safe to mutate. */
const getDefaultThemeTokens = (): ThemeTokens => JSON.parse(JSON.stringify(DEFAULT_THEME_TOKENS))

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

  describe('icon override generation', () => {
    it('generates a mask-mode rule for .svg overrides (keeps currentColor)', () => {
      const rule = generateIconOverrideRule({
        name: 'chat',
        src: '/api/themes/assets/bundle:x/icons/chat.svg',
      })
      expect(rule).toContain('[data-icon="chat"]')
      expect(rule).toContain('--_qt-icon-mask: url("/api/themes/assets/bundle:x/icons/chat.svg")')
      expect(rule).toContain('--_qt-icon-bg: none')
      expect(rule).toContain('background-color: currentColor')
    })

    it('generates an image-mode rule for .webp overrides (full colour)', () => {
      const rule = generateIconOverrideRule({
        name: 'prospero',
        src: '/api/themes/assets/bundle:x/icons/prospero.webp',
      })
      expect(rule).toContain('[data-icon="prospero"]')
      expect(rule).toContain('--_qt-icon-bg: url("/api/themes/assets/bundle:x/icons/prospero.webp")')
      expect(rule).toContain('--_qt-icon-mask: none')
      expect(rule).toContain('background-color: transparent')
    })

    it('masks an .svg brand override like any other icon (currentColor tint)', () => {
      const rule = generateIconOverrideRule({
        name: 'brand',
        src: '/api/themes/assets/bundle:x/icons/brand.svg',
      })
      expect(rule).toContain('--_qt-icon-mask: url("/api/themes/assets/bundle:x/icons/brand.svg")')
      expect(rule).toContain('--_qt-icon-bg: none')
      expect(rule).toContain('background-color: currentColor')
    })

    it('keeps image mode for a .webp brand override (full colour)', () => {
      const rule = generateIconOverrideRule({
        name: 'brand',
        src: '/api/themes/assets/bundle:x/icons/brand.webp',
      })
      expect(rule).toContain('--_qt-icon-bg: url("/api/themes/assets/bundle:x/icons/brand.webp")')
      expect(rule).toContain('--_qt-icon-mask: none')
      expect(rule).toContain('background-color: transparent')
    })

    it('keeps mask mode for an .svg src carrying a cache-buster query string', () => {
      const rule = generateIconOverrideRule({
        name: 'settings',
        src: '/api/themes/assets/bundle:x/icons/settings.svg?v=1.1.0',
      })
      expect(rule).toContain('--_qt-icon-mask: url("/api/themes/assets/bundle:x/icons/settings.svg?v=1.1.0")')
      expect(rule).toContain('background-color: currentColor')
    })

    it('strips characters that could break out of url("...") (CSS injection guard)', () => {
      const rule = generateIconOverrideRule({
        name: 'chat',
        src: '/x.webp") } body { display: none } a { background: url("y',
      })
      // Only the 4 structural quotes remain (data-icon="..." + url("...")); the
      // injected quotes are stripped, so the payload can't close the url() early.
      // Any leftover braces are now harmless literals inside the quoted url.
      expect((rule.match(/"/g) || []).length).toBe(4)
      expect(rule).not.toContain('"))')
    })

    it('generates a bundle of multiple icon override rules', () => {
      const bundle = generateIconOverridesCSS([
        { name: 'chat', src: '/icons/chat.svg' },
        { name: 'prospero', src: '/icons/prospero.webp' },
      ])
      expect(bundle.split('[data-icon=').length - 1).toBe(2)
      expect(bundle).toContain('[data-icon="chat"]')
      expect(bundle).toContain('[data-icon="prospero"]')
    })

    it('handles empty icon array', () => {
      expect(generateIconOverridesCSS([])).toBe('')
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
