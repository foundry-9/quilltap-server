/**
 * Theme Token System
 *
 * Defines the structure for theme customization at multiple levels:
 * - Tier 1: Design tokens (colors, fonts, spacing)
 * - Tier 2: Component tokens (semantic component styling)
 * - Tier 3: Component overrides (full CSS customization)
 *
 * @module themes/types
 */

import { z } from 'zod';
import { logger } from '@/lib/logger';

// ============================================================================
// COLOR TOKENS
// ============================================================================

/**
 * HSL color value pattern (e.g., "222.2 84% 4.9%")
 * Note: Does not include the hsl() wrapper - just the values
 */
const HSLValuesPattern = /^\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%$/;

/**
 * Full HSL color pattern (e.g., "hsl(222.2 84% 4.9%)")
 */
const HSLColorPattern = /^hsl\(\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%\)$/;

/**
 * Hex color value (e.g., "#1a1a2e")
 */
const HexColorPattern = /^#[0-9a-fA-F]{6}$/;

/**
 * CSS color schema - accepts HSL (with or without wrapper), hex, or named colors
 */
const CSSColorSchema = z.string().refine(
  (val) => {
    // Accept HSL values (with or without hsl() wrapper)
    if (HSLValuesPattern.test(val) || HSLColorPattern.test(val)) return true;
    // Accept hex colors
    if (HexColorPattern.test(val)) return true;
    // Accept CSS named colors and other valid CSS color values
    // This is permissive to allow rgb(), rgba(), oklch(), etc.
    if (val.length > 0) return true;
    return false;
  },
  {
      error: 'Invalid CSS color value'
}
);

/**
 * Color palette schema for a single color mode (light or dark)
 */
export const ColorPaletteSchema = z.object({
  // Semantic colors - primary surfaces
  background: CSSColorSchema.describe('Main background color'),
  foreground: CSSColorSchema.describe('Main text color'),

  // Primary action colors
  primary: CSSColorSchema.describe('Primary brand/action color'),
  primaryForeground: CSSColorSchema.describe('Text on primary color'),

  // Secondary/muted colors
  secondary: CSSColorSchema.describe('Secondary background color'),
  secondaryForeground: CSSColorSchema.describe('Text on secondary color'),

  // Muted text and backgrounds
  muted: CSSColorSchema.describe('Muted background for less prominent elements'),
  mutedForeground: CSSColorSchema.describe('Muted text color'),

  // Accent colors
  accent: CSSColorSchema.describe('Accent color for highlights'),
  accentForeground: CSSColorSchema.describe('Text on accent color'),

  // Destructive/error colors
  destructive: CSSColorSchema.describe('Error/destructive action color'),
  destructiveForeground: CSSColorSchema.describe('Text on destructive color'),

  // Card and popover surfaces
  card: CSSColorSchema.describe('Card background color'),
  cardForeground: CSSColorSchema.describe('Card text color'),
  popover: CSSColorSchema.describe('Popover/dropdown background'),
  popoverForeground: CSSColorSchema.describe('Popover text color'),

  // Borders and inputs
  border: CSSColorSchema.describe('Default border color'),
  input: CSSColorSchema.describe('Input field border color'),
  ring: CSSColorSchema.describe('Focus ring color'),

  // Optional: Extended palette for advanced themes
  success: CSSColorSchema.optional().describe('Success state color'),
  successForeground: CSSColorSchema.optional().describe('Text on success color'),
  warning: CSSColorSchema.optional().describe('Warning state color'),
  warningForeground: CSSColorSchema.optional().describe('Text on warning color'),
  info: CSSColorSchema.optional().describe('Info state color'),
  infoForeground: CSSColorSchema.optional().describe('Text on info color'),

  // Chat-specific colors
  chatUser: CSSColorSchema.optional().describe('User message bubble background'),
  chatUserForeground: CSSColorSchema.optional().describe('User message bubble text'),
});

export type ColorPalette = z.infer<typeof ColorPaletteSchema>;

// ============================================================================
// TYPOGRAPHY TOKENS
// ============================================================================

/**
 * Typography token schema
 */
export const TypographySchema = z.object({
  // Font families
  fontSans: z.string().default('Inter, system-ui, sans-serif').describe('Sans-serif font stack'),
  fontSerif: z.string().default('Georgia, serif').describe('Serif font stack'),
  fontMono: z.string().default('ui-monospace, SFMono-Regular, monospace').describe('Monospace font stack'),

  // Font size scale (rem values)
  fontSizeXs: z.string().default('0.75rem').describe('Extra small text (12px)'),
  fontSizeSm: z.string().default('0.875rem').describe('Small text (14px)'),
  fontSizeBase: z.string().default('1rem').describe('Base text size (16px)'),
  fontSizeLg: z.string().default('1.125rem').describe('Large text (18px)'),
  fontSizeXl: z.string().default('1.25rem').describe('Extra large text (20px)'),
  fontSize2xl: z.string().default('1.5rem').describe('2XL text (24px)'),
  fontSize3xl: z.string().default('1.875rem').describe('3XL text (30px)'),
  fontSize4xl: z.string().default('2.25rem').describe('4XL text (36px)'),

  // Line heights
  lineHeightTight: z.string().default('1.25').describe('Tight line height'),
  lineHeightNormal: z.string().default('1.5').describe('Normal line height'),
  lineHeightRelaxed: z.string().default('1.75').describe('Relaxed line height'),

  // Font weights
  fontWeightNormal: z.string().default('400').describe('Normal font weight'),
  fontWeightMedium: z.string().default('500').describe('Medium font weight'),
  fontWeightSemibold: z.string().default('600').describe('Semibold font weight'),
  fontWeightBold: z.string().default('700').describe('Bold font weight'),

  // Letter spacing
  letterSpacingTight: z.string().default('-0.025em').describe('Tight letter spacing'),
  letterSpacingNormal: z.string().default('0').describe('Normal letter spacing'),
  letterSpacingWide: z.string().default('0.025em').describe('Wide letter spacing'),
});

export type Typography = z.infer<typeof TypographySchema>;

// ============================================================================
// SPACING & LAYOUT TOKENS
// ============================================================================

/**
 * Spacing and layout token schema
 */
export const SpacingSchema = z.object({
  // Border radius
  radiusSm: z.string().default('calc(0.5rem - 4px)').describe('Small border radius'),
  radiusMd: z.string().default('calc(0.5rem - 2px)').describe('Medium border radius'),
  radiusLg: z.string().default('0.5rem').describe('Large border radius'),
  radiusXl: z.string().default('0.75rem').describe('Extra large border radius'),
  radiusFull: z.string().default('9999px').describe('Full/pill border radius'),

  // Spacing scale (for padding, margin, gap)
  spacing1: z.string().default('0.25rem').describe('4px spacing'),
  spacing2: z.string().default('0.5rem').describe('8px spacing'),
  spacing3: z.string().default('0.75rem').describe('12px spacing'),
  spacing4: z.string().default('1rem').describe('16px spacing'),
  spacing5: z.string().default('1.25rem').describe('20px spacing'),
  spacing6: z.string().default('1.5rem').describe('24px spacing'),
  spacing8: z.string().default('2rem').describe('32px spacing'),
  spacing10: z.string().default('2.5rem').describe('40px spacing'),
  spacing12: z.string().default('3rem').describe('48px spacing'),
  spacing16: z.string().default('4rem').describe('64px spacing'),
});

export type Spacing = z.infer<typeof SpacingSchema>;

// ============================================================================
// EFFECTS TOKENS
// ============================================================================

/**
 * Visual effects token schema
 */
export const EffectsSchema = z.object({
  // Shadows
  shadowSm: z.string().default('0 1px 2px 0 rgb(0 0 0 / 0.05)').describe('Small shadow'),
  shadowMd: z.string().default('0 4px 6px -1px rgb(0 0 0 / 0.1)').describe('Medium shadow'),
  shadowLg: z.string().default('0 10px 15px -3px rgb(0 0 0 / 0.1)').describe('Large shadow'),
  shadowXl: z.string().default('0 20px 25px -5px rgb(0 0 0 / 0.1)').describe('Extra large shadow'),

  // Transitions
  transitionFast: z.string().default('150ms').describe('Fast transition duration'),
  transitionNormal: z.string().default('200ms').describe('Normal transition duration'),
  transitionSlow: z.string().default('300ms').describe('Slow transition duration'),
  transitionEasing: z.string().default('cubic-bezier(0.4, 0, 0.2, 1)').describe('Default easing function'),

  // Focus ring
  focusRingWidth: z.string().default('2px').describe('Focus ring width'),
  focusRingOffset: z.string().default('2px').describe('Focus ring offset'),
});

export type Effects = z.infer<typeof EffectsSchema>;

// ============================================================================
// COMPLETE THEME TOKENS
// ============================================================================

/**
 * Complete theme tokens schema
 *
 * Contains all customizable values for a theme:
 * - colors: Required light and dark mode color palettes
 * - typography: Optional font customization
 * - spacing: Optional spacing/radius customization
 * - effects: Optional shadows/transitions customization
 */
export const ThemeTokensSchema = z.object({
  colors: z.object({
    light: ColorPaletteSchema.describe('Light mode color palette'),
    dark: ColorPaletteSchema.describe('Dark mode color palette'),
  }),
  typography: TypographySchema.optional().describe('Typography customization'),
  spacing: SpacingSchema.optional().describe('Spacing and radius customization'),
  effects: EffectsSchema.optional().describe('Shadow and transition customization'),
});

export type ThemeTokens = z.infer<typeof ThemeTokensSchema>;

// ============================================================================
// FONT DEFINITION
// ============================================================================

/**
 * Custom font definition for themes that include custom fonts
 */
export const FontDefinitionSchema = z.object({
  /** Font family name */
  family: z.string().min(1).describe('Font family name'),
  /** Font source URL or relative path */
  src: z.string().min(1).describe('Font file URL or path'),
  /** Font weight (e.g., "400", "700", "400 700") */
  weight: z.string().optional().describe('Font weight'),
  /** Font style (e.g., "normal", "italic") */
  style: z.string().optional().describe('Font style'),
  /** Font display strategy */
  display: z.enum(['auto', 'block', 'swap', 'fallback', 'optional']).default('swap'),
});

export type FontDefinition = z.infer<typeof FontDefinitionSchema>;

// ============================================================================
// THEME MANIFEST
// ============================================================================

/**
 * Theme manifest schema
 *
 * Defines the metadata and configuration for a theme.
 * This is typically embedded within a plugin manifest via themeConfig,
 * but can also be used standalone for theme validation.
 */
export const ThemeManifestSchema = z.object({
  // Theme identity
  id: z.string().regex(/^[a-z][a-z0-9-]*$/).describe('Theme identifier (lowercase, hyphens)'),
  name: z.string().min(1).max(100).describe('Display name'),
  description: z.string().max(500).optional().describe('Theme description'),
  version: z.string().describe('Semantic version'),
  author: z.union([
    z.string(),
    z.object({
      name: z.string(),
      email: z.email().optional(),
      url: z.url().optional(),
    }),
  ]).describe('Theme author'),

  // Theme configuration
  tokens: ThemeTokensSchema.describe('Theme design tokens'),

  // Optional: Custom fonts to load
  fonts: z.array(FontDefinitionSchema).optional().describe('Custom fonts to load'),

  // Optional: Component-specific CSS overrides (Tier 3)
  componentStyles: z.string().optional().describe('Path to component override CSS file'),

  // Optional: Preview image
  preview: z.string().optional().describe('Preview image path'),

  // Theme category/tags
  tags: z.array(z.string()).optional().describe('Theme tags for categorization'),

  // Whether this theme supports dark mode (default: true)
  supportsDarkMode: z.boolean().default(true).describe('Whether theme provides dark mode'),
});

export type ThemeManifest = z.infer<typeof ThemeManifestSchema>;

// ============================================================================
// USER THEME PREFERENCE
// ============================================================================

/**
 * Color mode options
 */
export const ColorModeSchema = z.enum(['light', 'dark', 'system']);
export type ColorMode = z.infer<typeof ColorModeSchema>;

/**
 * User theme preference schema
 *
 * Stored in chat_settings to persist user's theme choices.
 */
export const ThemePreferenceSchema = z.object({
  /** Active theme plugin ID (null = default theme) */
  activeThemeId: z.string().nullable().default(null),

  /** Color mode preference */
  colorMode: ColorModeSchema.default('system'),

  /** Custom token overrides (user tweaks on top of selected theme) */
  customOverrides: z.record(z.string(), z.string()).optional(),

  /** Whether to show theme selector in the navigation bar */
  showNavThemeSelector: z.boolean().default(false),
});

export type ThemePreference = z.infer<typeof ThemePreferenceSchema>;

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validates theme tokens
 * @param data - The tokens data to validate
 * @returns Validated and typed tokens
 * @throws ZodError if validation fails
 */
export function validateThemeTokens(data: unknown): ThemeTokens {
  return ThemeTokensSchema.parse(data);
}

/**
 * Safely validates theme tokens, returning errors instead of throwing
 * @param data - The tokens data to validate
 * @returns Success or error result
 */
export function safeValidateThemeTokens(data: unknown):
  | { success: true; data: ThemeTokens }
  | { success: false; errors: z.ZodError } {
  const result = ThemeTokensSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  logger.warn('Theme tokens validation failed', {
    errorCount: result.error.issues.length,
    errors: result.error.issues.map(e => ({
      path: e.path.join('.'),
      message: e.message,
    })),
  });
  return { success: false, errors: result.error };
}

/**
 * Validates a theme manifest
 * @param data - The manifest data to validate
 * @returns Validated and typed manifest
 * @throws ZodError if validation fails
 */
export function validateThemeManifest(data: unknown): ThemeManifest {
  return ThemeManifestSchema.parse(data);
}

/**
 * Safely validates a theme manifest
 * @param data - The manifest data to validate
 * @returns Success or error result
 */
export function safeValidateThemeManifest(data: unknown):
  | { success: true; data: ThemeManifest }
  | { success: false; errors: z.ZodError } {
  const result = ThemeManifestSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  logger.warn('Theme manifest validation failed', {
    errorCount: result.error.issues.length,
    errors: result.error.issues.map(e => ({
      path: e.path.join('.'),
      message: e.message,
    })),
  });
  return { success: false, errors: result.error };
}

/**
 * Validates theme preference
 * @param data - The preference data to validate
 * @returns Validated and typed preference
 * @throws ZodError if validation fails
 */
export function validateThemePreference(data: unknown): ThemePreference {
  return ThemePreferenceSchema.parse(data);
}

/**
 * Creates a default theme preference
 */
export function createDefaultThemePreference(): ThemePreference {
  return {
    activeThemeId: null,
    colorMode: 'system',
    showNavThemeSelector: false,
  };
}
