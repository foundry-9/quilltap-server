import {
  DEFAULT_THEME_TOKENS,
  DEFAULT_THEME_METADATA,
} from '@/lib/themes/default-tokens'

describe('default theme tokens', () => {
  describe('DEFAULT_THEME_TOKENS structure', () => {
    it('contains all required color palettes', () => {
      expect(DEFAULT_THEME_TOKENS.colors).toBeDefined()
      expect(DEFAULT_THEME_TOKENS.colors.light).toBeDefined()
      expect(DEFAULT_THEME_TOKENS.colors.dark).toBeDefined()
    })

    it('contains light mode colors', () => {
      const { light } = DEFAULT_THEME_TOKENS.colors
      expect(light.background).toBeDefined()
      expect(light.foreground).toBeDefined()
      expect(light.primary).toBeDefined()
      expect(light.primaryForeground).toBeDefined()
      expect(light.secondary).toBeDefined()
      expect(light.secondaryForeground).toBeDefined()
      expect(light.muted).toBeDefined()
      expect(light.mutedForeground).toBeDefined()
      expect(light.accent).toBeDefined()
      expect(light.accentForeground).toBeDefined()
      expect(light.destructive).toBeDefined()
      expect(light.destructiveForeground).toBeDefined()
      expect(light.card).toBeDefined()
      expect(light.cardForeground).toBeDefined()
      expect(light.popover).toBeDefined()
      expect(light.popoverForeground).toBeDefined()
      expect(light.border).toBeDefined()
      expect(light.input).toBeDefined()
      expect(light.ring).toBeDefined()
    })

    it('contains dark mode colors', () => {
      const { dark } = DEFAULT_THEME_TOKENS.colors
      expect(dark.background).toBeDefined()
      expect(dark.foreground).toBeDefined()
      expect(dark.primary).toBeDefined()
      expect(dark.primaryForeground).toBeDefined()
      expect(dark.secondary).toBeDefined()
      expect(dark.secondaryForeground).toBeDefined()
      expect(dark.muted).toBeDefined()
      expect(dark.mutedForeground).toBeDefined()
      expect(dark.accent).toBeDefined()
      expect(dark.accentForeground).toBeDefined()
      expect(dark.destructive).toBeDefined()
      expect(dark.destructiveForeground).toBeDefined()
      expect(dark.card).toBeDefined()
      expect(dark.cardForeground).toBeDefined()
      expect(dark.popover).toBeDefined()
      expect(dark.popoverForeground).toBeDefined()
      expect(dark.border).toBeDefined()
      expect(dark.input).toBeDefined()
      expect(dark.ring).toBeDefined()
    })

    it('contains typography settings', () => {
      const typography = DEFAULT_THEME_TOKENS.typography
      expect(typography).toBeDefined()
      expect(typography?.fontSans).toBeDefined()
      expect(typography?.fontSerif).toBeDefined()
      expect(typography?.fontMono).toBeDefined()
      expect(typography?.fontSizeBase).toBeDefined()
      expect(typography?.lineHeightNormal).toBeDefined()
      expect(typography?.fontWeightNormal).toBeDefined()
    })

    it('contains spacing settings', () => {
      const spacing = DEFAULT_THEME_TOKENS.spacing
      expect(spacing).toBeDefined()
      expect(spacing?.radiusSm).toBeDefined()
      expect(spacing?.radiusMd).toBeDefined()
      expect(spacing?.radiusLg).toBeDefined()
      expect(spacing?.spacing1).toBeDefined()
      expect(spacing?.spacing4).toBeDefined()
    })

    it('contains effects settings', () => {
      const effects = DEFAULT_THEME_TOKENS.effects
      expect(effects).toBeDefined()
      expect(effects?.shadowSm).toBeDefined()
      expect(effects?.shadowMd).toBeDefined()
      expect(effects?.transitionNormal).toBeDefined()
      expect(effects?.focusRingWidth).toBeDefined()
    })

    it('uses valid HSL color format for light colors', () => {
      const { light } = DEFAULT_THEME_TOKENS.colors
      expect(light.background).toMatch(/hsl\(/)
      expect(light.primary).toMatch(/hsl\(/)
      expect(light.destructive).toMatch(/hsl\(/)
    })

    it('uses valid HSL color format for dark colors', () => {
      const { dark } = DEFAULT_THEME_TOKENS.colors
      expect(dark.background).toMatch(/hsl\(/)
      expect(dark.primary).toMatch(/hsl\(/)
      expect(dark.destructive).toMatch(/hsl\(/)
    })

    it('uses valid CSS units for font sizes', () => {
      const typography = DEFAULT_THEME_TOKENS.typography!
      expect(typography.fontSizeXs).toMatch(/rem$/)
      expect(typography.fontSizeSm).toMatch(/rem$/)
      expect(typography.fontSizeBase).toMatch(/rem$/)
      expect(typography.fontSizeLg).toMatch(/rem$/)
    })

    it('uses valid CSS units for spacing', () => {
      const spacing = DEFAULT_THEME_TOKENS.spacing!
      expect(spacing.spacing1).toMatch(/rem$/)
      expect(spacing.spacing2).toMatch(/rem$/)
      expect(spacing.spacing4).toMatch(/rem$/)
    })

    it('uses valid CSS units for transitions', () => {
      const effects = DEFAULT_THEME_TOKENS.effects!
      expect(effects.transitionFast).toMatch(/ms$/)
      expect(effects.transitionNormal).toMatch(/ms$/)
      expect(effects.transitionSlow).toMatch(/ms$/)
    })
  })

  describe('DEFAULT_THEME_METADATA', () => {
    it('contains required metadata fields', () => {
      expect(DEFAULT_THEME_METADATA.id).toBe('default')
      expect(DEFAULT_THEME_METADATA.name).toBe('Default')
      expect(DEFAULT_THEME_METADATA.description).toBeDefined()
      expect(DEFAULT_THEME_METADATA.version).toBeDefined()
      expect(DEFAULT_THEME_METADATA.author).toBeDefined()
      expect(DEFAULT_THEME_METADATA.supportsDarkMode).toBe(true)
      expect(DEFAULT_THEME_METADATA.tags).toBeDefined()
    })

    it('has meaningful description', () => {
      expect(DEFAULT_THEME_METADATA.description.length).toBeGreaterThan(10)
    })

    it('has appropriate tags', () => {
      expect(Array.isArray(DEFAULT_THEME_METADATA.tags)).toBe(true)
      expect(DEFAULT_THEME_METADATA.tags.length).toBeGreaterThan(0)
    })
  })

  describe('color contrast validation', () => {
    it('uses different colors for light and dark modes', () => {
      const { light, dark } = DEFAULT_THEME_TOKENS.colors
      expect(light.background).not.toBe(dark.background)
      expect(light.foreground).not.toBe(dark.foreground)
      expect(light.primary).not.toBe(dark.primary)
    })

    it('provides contrasting background and foreground for light mode', () => {
      const { light } = DEFAULT_THEME_TOKENS.colors
      // Light mode: light background (97%), dark foreground (13%)
      expect(light.background).toContain('97%')
      expect(light.foreground).toContain('13%')
    })

    it('provides contrasting background and foreground for dark mode', () => {
      const { dark } = DEFAULT_THEME_TOKENS.colors
      // Dark mode: dark background (9%), light foreground (92%)
      expect(dark.background).toContain('9%')
      expect(dark.foreground).toContain('92%')
    })
  })
})
