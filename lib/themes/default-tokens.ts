/**
 * Default Theme Tokens
 *
 * These values match the current globals.css and serve as the
 * fallback when no theme plugin is active. They represent the
 * "Default" theme that ships with Quilltap.
 *
 * @module themes/default-tokens
 */

import type { ThemeTokens, Typography, Spacing, Effects } from './types';

// ============================================================================
// DEFAULT COLOR PALETTES
// ============================================================================

/**
 * Default light mode colors
 * Extracted from globals.css - warm slate-blue palette
 * Base hue: 220 (slate-blue) for professional, neutral warmth
 */
const DEFAULT_LIGHT_COLORS = {
  background: 'hsl(220 20% 97%)',
  foreground: 'hsl(220 25% 12%)',
  primary: 'hsl(220 60% 20%)',
  primaryForeground: 'hsl(220 20% 98%)',
  secondary: 'hsl(220 15% 92%)',
  secondaryForeground: 'hsl(220 25% 25%)',
  muted: 'hsl(220 15% 94%)',
  mutedForeground: 'hsl(220 10% 45%)',
  accent: 'hsl(210 60% 95%)',
  accentForeground: 'hsl(210 70% 35%)',
  destructive: 'hsl(0 72% 51%)',
  destructiveForeground: 'hsl(0 0% 100%)',
  card: 'hsl(220 20% 100%)',
  cardForeground: 'hsl(220 25% 12%)',
  popover: 'hsl(220 20% 100%)',
  popoverForeground: 'hsl(220 25% 12%)',
  border: 'hsl(220 15% 88%)',
  input: 'hsl(220 15% 88%)',
  ring: 'hsl(220 60% 50%)',
} as const;

/**
 * Default dark mode colors
 * Extracted from globals.css - warm slate-blue palette
 * Creates visible surface hierarchy: page (8%) → card (12%) → popover (15%)
 */
const DEFAULT_DARK_COLORS = {
  background: 'hsl(220 25% 8%)',
  foreground: 'hsl(220 15% 92%)',
  primary: 'hsl(220 50% 75%)',
  primaryForeground: 'hsl(220 25% 8%)',
  secondary: 'hsl(220 20% 18%)',
  secondaryForeground: 'hsl(220 15% 85%)',
  muted: 'hsl(220 15% 15%)',
  mutedForeground: 'hsl(220 10% 55%)',
  accent: 'hsl(210 50% 20%)',
  accentForeground: 'hsl(210 70% 75%)',
  destructive: 'hsl(0 65% 55%)',
  destructiveForeground: 'hsl(0 0% 100%)',
  card: 'hsl(220 20% 12%)',
  cardForeground: 'hsl(220 15% 92%)',
  popover: 'hsl(220 20% 15%)',
  popoverForeground: 'hsl(220 15% 92%)',
  border: 'hsl(220 15% 20%)',
  input: 'hsl(220 15% 20%)',
  ring: 'hsl(220 60% 60%)',
} as const;

// ============================================================================
// DEFAULT TYPOGRAPHY
// ============================================================================

/**
 * Default typography settings
 * Uses Inter as the primary font (loaded via @font-face in globals.css)
 */
export const DEFAULT_TYPOGRAPHY: Typography = {
  // Font families
  fontSans: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
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
 * Extracted from globals.css @theme block
 */
export const DEFAULT_SPACING: Spacing = {
  // Border radius (from globals.css)
  radiusSm: 'calc(0.5rem - 4px)',  // ~4px
  radiusMd: 'calc(0.5rem - 2px)',  // ~6px
  radiusLg: '0.5rem',              // 8px
  radiusXl: '0.75rem',             // 12px
  radiusFull: '9999px',            // Full/pill

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
 */
export const DEFAULT_EFFECTS: Effects = {
  // Shadows (Tailwind defaults)
  shadowSm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  shadowMd: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  shadowLg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  shadowXl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',

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
  description: 'The default Quilltap theme with a clean, professional appearance',
  version: '1.0.0',
  author: 'Quilltap',
  supportsDarkMode: true,
  tags: ['default', 'professional', 'clean'],
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
