/**
 * Default Theme Tokens — Professional Neutral
 *
 * These values match the current globals.css and serve as the
 * fallback when no theme plugin is active. They represent the
 * "Default" theme that ships with Quilltap.
 *
 * Base hue: 225 (cool blue-gray) — neutral, precise, professional.
 * System font stack throughout — no decorative fonts.
 *
 * @module themes/default-tokens
 */

import type { ThemeTokens, Typography, Spacing, Effects } from './types';

// ============================================================================
// DEFAULT COLOR PALETTES
// ============================================================================

/**
 * Default light mode colors
 * Cool blue-gray palette (hue 225) with low saturation
 * Professional, neutral, and precise
 */
const DEFAULT_LIGHT_COLORS = {
  background: 'hsl(225 14% 97%)',
  foreground: 'hsl(225 18% 13%)',
  primary: 'hsl(225 65% 48%)',
  primaryForeground: 'hsl(0 0% 100%)',
  secondary: 'hsl(225 10% 92%)',
  secondaryForeground: 'hsl(225 18% 22%)',
  muted: 'hsl(225 10% 94%)',
  mutedForeground: 'hsl(225 8% 42%)',
  accent: 'hsl(225 10% 93%)',
  accentForeground: 'hsl(225 18% 22%)',
  destructive: 'hsl(0 68% 50%)',
  destructiveForeground: 'hsl(0 0% 100%)',
  card: 'hsl(0 0% 100%)',
  cardForeground: 'hsl(225 18% 13%)',
  popover: 'hsl(0 0% 100%)',
  popoverForeground: 'hsl(225 18% 13%)',
  border: 'hsl(225 10% 87%)',
  input: 'hsl(225 10% 87%)',
  ring: 'hsl(225 65% 48%)',
  success: 'hsl(152 60% 38%)',
  successForeground: 'hsl(0 0% 100%)',
  warning: 'hsl(38 90% 46%)',
  warningForeground: 'hsl(0 0% 10%)',
  info: 'hsl(210 75% 48%)',
  infoForeground: 'hsl(0 0% 100%)',
  chatUser: 'hsl(225 62% 50%)',
  chatUserForeground: 'hsl(0 0% 100%)',
} as const;

/**
 * Default dark mode colors
 * Cool blue-gray palette (hue 225) with low saturation
 * Creates visible surface hierarchy: page (9%) → card (12%) → popover (14%)
 */
const DEFAULT_DARK_COLORS = {
  background: 'hsl(225 18% 9%)',
  foreground: 'hsl(225 10% 92%)',
  primary: 'hsl(225 55% 68%)',
  primaryForeground: 'hsl(225 18% 9%)',
  secondary: 'hsl(225 14% 17%)',
  secondaryForeground: 'hsl(225 10% 85%)',
  muted: 'hsl(225 12% 14%)',
  mutedForeground: 'hsl(225 8% 56%)',
  accent: 'hsl(225 14% 18%)',
  accentForeground: 'hsl(225 10% 85%)',
  destructive: 'hsl(0 60% 54%)',
  destructiveForeground: 'hsl(0 0% 100%)',
  card: 'hsl(225 16% 12%)',
  cardForeground: 'hsl(225 10% 92%)',
  popover: 'hsl(225 16% 14%)',
  popoverForeground: 'hsl(225 10% 92%)',
  border: 'hsl(225 12% 20%)',
  input: 'hsl(225 12% 20%)',
  ring: 'hsl(225 55% 60%)',
  success: 'hsl(152 55% 44%)',
  successForeground: 'hsl(0 0% 100%)',
  warning: 'hsl(38 85% 52%)',
  warningForeground: 'hsl(0 0% 10%)',
  info: 'hsl(210 70% 58%)',
  infoForeground: 'hsl(0 0% 100%)',
  chatUser: 'hsl(225 60% 56%)',
  chatUserForeground: 'hsl(0 0% 100%)',
} as const;

// ============================================================================
// DEFAULT TYPOGRAPHY
// ============================================================================

/**
 * Default typography settings
 * System font stack throughout — San Francisco on Mac, Segoe UI on Windows
 */
export const DEFAULT_TYPOGRAPHY: Typography = {
  // Font families
  fontSans: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontSerif: 'Georgia, Cambria, "Times New Roman", Times, serif',
  fontMono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',

  // Font size scale
  fontSizeXs: '0.75rem',     // 12px
  fontSizeSm: '0.875rem',    // 14px
  fontSizeBase: '1rem',      // 16px
  fontSizeLg: '1.125rem',    // 18px
  fontSizeXl: '1.25rem',     // 20px
  fontSize2xl: '1.5rem',     // 24px
  fontSize3xl: '1.875rem',   // 30px
  fontSize4xl: '2.25rem',    // 36px

  // Line heights
  lineHeightTight: '1.25',
  lineHeightNormal: '1.5',
  lineHeightRelaxed: '1.75',

  // Font weights
  fontWeightNormal: '400',
  fontWeightMedium: '500',
  fontWeightSemibold: '600',
  fontWeightBold: '700',

  // Letter spacing
  letterSpacingTight: '-0.025em',
  letterSpacingNormal: '0',
  letterSpacingWide: '0.025em',
};

// ============================================================================
// DEFAULT SPACING
// ============================================================================

/**
 * Default spacing and border radius values
 * Tighter radii for a precise, engineered look
 */
export const DEFAULT_SPACING: Spacing = {
  // Border radius
  radiusSm: '0.25rem',    // 4px
  radiusMd: '0.375rem',   // 6px
  radiusLg: '0.5rem',     // 8px
  radiusXl: '0.625rem',   // 10px
  radiusFull: '9999px',   // Full/pill

  // Spacing scale (Tailwind defaults)
  spacing1: '0.25rem',   // 4px
  spacing2: '0.5rem',    // 8px
  spacing3: '0.75rem',   // 12px
  spacing4: '1rem',      // 16px
  spacing5: '1.25rem',   // 20px
  spacing6: '1.5rem',    // 24px
  spacing8: '2rem',      // 32px
  spacing10: '2.5rem',   // 40px
  spacing12: '3rem',     // 48px
  spacing16: '4rem',     // 64px
};

// ============================================================================
// DEFAULT EFFECTS
// ============================================================================

/**
 * Default visual effects (shadows, transitions)
 * Restrained shadows — visible but never showy
 */
export const DEFAULT_EFFECTS: Effects = {
  // Shadows
  shadowSm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  shadowMd: '0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.05)',
  shadowLg: '0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.04)',
  shadowXl: '0 20px 25px -5px rgb(0 0 0 / 0.08), 0 8px 10px -6px rgb(0 0 0 / 0.04)',

  // Transitions
  transitionFast: '150ms',
  transitionNormal: '200ms',
  transitionSlow: '300ms',
  transitionEasing: 'cubic-bezier(0.4, 0, 0.2, 1)',

  // Focus ring
  focusRingWidth: '2px',
  focusRingOffset: '2px',
};

// ============================================================================
// COMPLETE DEFAULT THEME
// ============================================================================

/**
 * Complete default theme tokens
 *
 * This is the fallback theme used when:
 * - No theme plugin is active
 * - A theme plugin fails to load
 * - The user selects "Default" theme
 */
export const DEFAULT_THEME_TOKENS: ThemeTokens = {
  colors: {
    light: DEFAULT_LIGHT_COLORS,
    dark: DEFAULT_DARK_COLORS,
  },
  typography: DEFAULT_TYPOGRAPHY,
  spacing: DEFAULT_SPACING,
  effects: DEFAULT_EFFECTS,
};

// ============================================================================
// THEME METADATA
// ============================================================================

/**
 * Default theme metadata
 * Used when displaying the default theme in the theme picker
 */
export const DEFAULT_THEME_METADATA = {
  id: 'default',
  name: 'Default',
  description: 'Professional neutral theme with system fonts and restrained design',
  version: '1.0.0',
  author: 'Quilltap',
  supportsDarkMode: true,
  tags: ['default', 'professional', 'neutral', 'system-fonts'],
} as const;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get the default theme tokens
 * @returns A copy of the default theme tokens
 */
export function getDefaultThemeTokens(): ThemeTokens {
  // Return a deep copy to prevent mutations
  return JSON.parse(JSON.stringify(DEFAULT_THEME_TOKENS));
}

/**
 * Get default colors for a specific mode
 * @param mode - 'light' or 'dark'
 * @returns Color palette for the specified mode
 */
export function getDefaultColors(mode: 'light' | 'dark') {
  return mode === 'light' ? { ...DEFAULT_LIGHT_COLORS } : { ...DEFAULT_DARK_COLORS };
}

/**
 * Get the default typography settings
 * @returns A copy of the default typography
 */
export function getDefaultTypography(): Typography {
  return { ...DEFAULT_TYPOGRAPHY };
}

/**
 * Get the default spacing settings
 * @returns A copy of the default spacing
 */
export function getDefaultSpacing(): Spacing {
  return { ...DEFAULT_SPACING };
}

/**
 * Get the default effects settings
 * @returns A copy of the default effects
 */
export function getDefaultEffects(): Effects {
  return { ...DEFAULT_EFFECTS };
}
