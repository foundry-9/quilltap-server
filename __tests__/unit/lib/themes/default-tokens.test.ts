import {
  DEFAULT_THEME_TOKENS,
  DEFAULT_THEME_METADATA,
  getDefaultThemeTokens,
  getDefaultColors,
  getDefaultTypography,
  getDefaultSpacing,
  getDefaultEffects,
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

  describe('getDefaultThemeTokens', () => {
    it('returns a complete copy of default theme tokens', () => {
      const tokens = getDefaultThemeTokens()
      expect(tokens).toEqual(DEFAULT_THEME_TOKENS)
    })

    it('returns a deep copy to prevent mutations', () => {
      const tokens1 = getDefaultThemeTokens()
      const tokens2 = getDefaultThemeTokens()

      tokens1.colors.light.primary = '#MUTATED'

      expect(tokens2.colors.light.primary).not.toBe('#MUTATED')
      expect(tokens2.colors.light.primary).toBe(DEFAULT_THEME_TOKENS.colors.light.primary)
    })

    it('includes all color palettes', () => {
      const tokens = getDefaultThemeTokens()
      expect(tokens.colors.light).toBeDefined()
      expect(tokens.colors.dark).toBeDefined()
    })

    it('includes typography settings', () => {
      const tokens = getDefaultThemeTokens()
      expect(tokens.typography).toBeDefined()
    })

    it('includes spacing settings', () => {
      const tokens = getDefaultThemeTokens()
      expect(tokens.spacing).toBeDefined()
    })

    it('includes effects settings', () => {
      const tokens = getDefaultThemeTokens()
      expect(tokens.effects).toBeDefined()
    })
  })

  describe('getDefaultColors', () => {
    it('returns light mode colors when mode is light', () => {
      const colors = getDefaultColors('light')
      expect(colors.background).toBe(DEFAULT_THEME_TOKENS.colors.light.background)
      expect(colors.primary).toBe(DEFAULT_THEME_TOKENS.colors.light.primary)
    })

    it('returns dark mode colors when mode is dark', () => {
      const colors = getDefaultColors('dark')
      expect(colors.background).toBe(DEFAULT_THEME_TOKENS.colors.dark.background)
      expect(colors.primary).toBe(DEFAULT_THEME_TOKENS.colors.dark.primary)
    })

    it('returns a copy to prevent mutations', () => {
      const colors1 = getDefaultColors('light')
      const colors2 = getDefaultColors('light')

      colors1.primary = '#MUTATED'

      expect(colors2.primary).not.toBe('#MUTATED')
      expect(colors2.primary).toBe(DEFAULT_THEME_TOKENS.colors.light.primary)
    })

    it('includes all color fields for light mode', () => {
      const colors = getDefaultColors('light')
      expect(colors.background).toBeDefined()
      expect(colors.foreground).toBeDefined()
      expect(colors.primary).toBeDefined()
      expect(colors.border).toBeDefined()
      expect(colors.destructive).toBeDefined()
    })

    it('includes all color fields for dark mode', () => {
      const colors = getDefaultColors('dark')
      expect(colors.background).toBeDefined()
      expect(colors.foreground).toBeDefined()
      expect(colors.primary).toBeDefined()
      expect(colors.border).toBeDefined()
      expect(colors.destructive).toBeDefined()
    })
  })

  describe('getDefaultTypography', () => {
    it('returns a copy of default typography', () => {
      const typography = getDefaultTypography()
      expect(typography).toEqual(DEFAULT_THEME_TOKENS.typography)
    })

    it('returns a copy to prevent mutations', () => {
      const typography1 = getDefaultTypography()
      const typography2 = getDefaultTypography()

      typography1.fontSans = 'MUTATED'

      expect(typography2.fontSans).not.toBe('MUTATED')
      expect(typography2.fontSans).toBe(DEFAULT_THEME_TOKENS.typography?.fontSans)
    })

    it('includes all font family settings', () => {
      const typography = getDefaultTypography()
      expect(typography.fontSans).toBeDefined()
      expect(typography.fontSerif).toBeDefined()
      expect(typography.fontMono).toBeDefined()
    })

    it('includes all font size settings', () => {
      const typography = getDefaultTypography()
      expect(typography.fontSizeXs).toBeDefined()
      expect(typography.fontSizeSm).toBeDefined()
      expect(typography.fontSizeBase).toBeDefined()
      expect(typography.fontSizeLg).toBeDefined()
      expect(typography.fontSizeXl).toBeDefined()
    })

    it('includes all line height settings', () => {
      const typography = getDefaultTypography()
      expect(typography.lineHeightTight).toBeDefined()
      expect(typography.lineHeightNormal).toBeDefined()
      expect(typography.lineHeightRelaxed).toBeDefined()
    })

    it('includes all font weight settings', () => {
      const typography = getDefaultTypography()
      expect(typography.fontWeightNormal).toBeDefined()
      expect(typography.fontWeightMedium).toBeDefined()
      expect(typography.fontWeightSemibold).toBeDefined()
      expect(typography.fontWeightBold).toBeDefined()
    })

    it('includes all letter spacing settings', () => {
      const typography = getDefaultTypography()
      expect(typography.letterSpacingTight).toBeDefined()
      expect(typography.letterSpacingNormal).toBeDefined()
      expect(typography.letterSpacingWide).toBeDefined()
    })
  })

  describe('getDefaultSpacing', () => {
    it('returns a copy of default spacing', () => {
      const spacing = getDefaultSpacing()
      expect(spacing).toEqual(DEFAULT_THEME_TOKENS.spacing)
    })

    it('returns a copy to prevent mutations', () => {
      const spacing1 = getDefaultSpacing()
      const spacing2 = getDefaultSpacing()

      spacing1.radiusLg = 'MUTATED'

      expect(spacing2.radiusLg).not.toBe('MUTATED')
      expect(spacing2.radiusLg).toBe(DEFAULT_THEME_TOKENS.spacing?.radiusLg)
    })

    it('includes all radius settings', () => {
      const spacing = getDefaultSpacing()
      expect(spacing.radiusSm).toBeDefined()
      expect(spacing.radiusMd).toBeDefined()
      expect(spacing.radiusLg).toBeDefined()
      expect(spacing.radiusXl).toBeDefined()
      expect(spacing.radiusFull).toBeDefined()
    })

    it('includes all spacing scale settings', () => {
      const spacing = getDefaultSpacing()
      expect(spacing.spacing1).toBeDefined()
      expect(spacing.spacing2).toBeDefined()
      expect(spacing.spacing3).toBeDefined()
      expect(spacing.spacing4).toBeDefined()
      expect(spacing.spacing5).toBeDefined()
      expect(spacing.spacing6).toBeDefined()
      expect(spacing.spacing8).toBeDefined()
      expect(spacing.spacing10).toBeDefined()
      expect(spacing.spacing12).toBeDefined()
      expect(spacing.spacing16).toBeDefined()
    })
  })

  describe('getDefaultEffects', () => {
    it('returns a copy of default effects', () => {
      const effects = getDefaultEffects()
      expect(effects).toEqual(DEFAULT_THEME_TOKENS.effects)
    })

    it('returns a copy to prevent mutations', () => {
      const effects1 = getDefaultEffects()
      const effects2 = getDefaultEffects()

      effects1.shadowSm = 'MUTATED'

      expect(effects2.shadowSm).not.toBe('MUTATED')
      expect(effects2.shadowSm).toBe(DEFAULT_THEME_TOKENS.effects?.shadowSm)
    })

    it('includes all shadow settings', () => {
      const effects = getDefaultEffects()
      expect(effects.shadowSm).toBeDefined()
      expect(effects.shadowMd).toBeDefined()
      expect(effects.shadowLg).toBeDefined()
      expect(effects.shadowXl).toBeDefined()
    })

    it('includes all transition settings', () => {
      const effects = getDefaultEffects()
      expect(effects.transitionFast).toBeDefined()
      expect(effects.transitionNormal).toBeDefined()
      expect(effects.transitionSlow).toBeDefined()
      expect(effects.transitionEasing).toBeDefined()
    })

    it('includes all focus ring settings', () => {
      const effects = getDefaultEffects()
      expect(effects.focusRingWidth).toBeDefined()
      expect(effects.focusRingOffset).toBeDefined()
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
      // Light mode: light background (97%), dark foreground (12%)
      expect(light.background).toContain('97%')
      expect(light.foreground).toContain('12%')
    })

    it('provides contrasting background and foreground for dark mode', () => {
      const { dark } = DEFAULT_THEME_TOKENS.colors
      // Dark mode: dark background (8%), light foreground (92%)
      expect(dark.background).toContain('8%')
      expect(dark.foreground).toContain('92%')
    })
  })
})
