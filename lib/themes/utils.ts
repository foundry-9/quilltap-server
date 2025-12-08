/**
 * Theme Utilities
 *
 * Helper functions for generating CSS from theme tokens,
 * merging themes, and other theme-related operations.
 *
 * @module themes/utils
 */

import type { ThemeTokens, ColorPalette, Typography, Spacing, Effects } from './types';
import { DEFAULT_THEME_TOKENS } from './default-tokens';

// ============================================================================
// CSS VARIABLE NAME MAPPINGS
// ============================================================================

/**
 * Maps color palette keys to CSS variable names
 */
const COLOR_VAR_MAP: Record<keyof ColorPalette, string> = {
  background: '--color-background',
  foreground: '--color-foreground',
  primary: '--color-primary',
  primaryForeground: '--color-primary-foreground',
  secondary: '--color-secondary',
  secondaryForeground: '--color-secondary-foreground',
  muted: '--color-muted',
  mutedForeground: '--color-muted-foreground',
  accent: '--color-accent',
  accentForeground: '--color-accent-foreground',
  destructive: '--color-destructive',
  destructiveForeground: '--color-destructive-foreground',
  card: '--color-card',
  cardForeground: '--color-card-foreground',
  popover: '--color-popover',
  popoverForeground: '--color-popover-foreground',
  border: '--color-border',
  input: '--color-input',
  ring: '--color-ring',
  // Extended colors (optional)
  success: '--color-success',
  successForeground: '--color-success-foreground',
  warning: '--color-warning',
  warningForeground: '--color-warning-foreground',
  info: '--color-info',
  infoForeground: '--color-info-foreground',
};

/**
 * Maps typography keys to CSS variable names
 */
const TYPOGRAPHY_VAR_MAP: Record<keyof Typography, string> = {
  fontSans: '--font-sans',
  fontSerif: '--font-serif',
  fontMono: '--font-mono',
  fontSizeXs: '--font-size-xs',
  fontSizeSm: '--font-size-sm',
  fontSizeBase: '--font-size-base',
  fontSizeLg: '--font-size-lg',
  fontSizeXl: '--font-size-xl',
  fontSize2xl: '--font-size-2xl',
  fontSize3xl: '--font-size-3xl',
  fontSize4xl: '--font-size-4xl',
  lineHeightTight: '--line-height-tight',
  lineHeightNormal: '--line-height-normal',
  lineHeightRelaxed: '--line-height-relaxed',
  fontWeightNormal: '--font-weight-normal',
  fontWeightMedium: '--font-weight-medium',
  fontWeightSemibold: '--font-weight-semibold',
  fontWeightBold: '--font-weight-bold',
  letterSpacingTight: '--letter-spacing-tight',
  letterSpacingNormal: '--letter-spacing-normal',
  letterSpacingWide: '--letter-spacing-wide',
};

/**
 * Maps spacing keys to CSS variable names
 */
const SPACING_VAR_MAP: Record<keyof Spacing, string> = {
  radiusSm: '--radius-sm',
  radiusMd: '--radius-md',
  radiusLg: '--radius-lg',
  radiusXl: '--radius-xl',
  radiusFull: '--radius-full',
  spacing1: '--spacing-1',
  spacing2: '--spacing-2',
  spacing3: '--spacing-3',
  spacing4: '--spacing-4',
  spacing5: '--spacing-5',
  spacing6: '--spacing-6',
  spacing8: '--spacing-8',
  spacing10: '--spacing-10',
  spacing12: '--spacing-12',
  spacing16: '--spacing-16',
};

/**
 * Maps effects keys to CSS variable names
 */
const EFFECTS_VAR_MAP: Record<keyof Effects, string> = {
  shadowSm: '--shadow-sm',
  shadowMd: '--shadow-md',
  shadowLg: '--shadow-lg',
  shadowXl: '--shadow-xl',
  transitionFast: '--transition-fast',
  transitionNormal: '--transition-normal',
  transitionSlow: '--transition-slow',
  transitionEasing: '--transition-easing',
  focusRingWidth: '--focus-ring-width',
  focusRingOffset: '--focus-ring-offset',
};

// ============================================================================
// CSS GENERATION
// ============================================================================

/**
 * Generate CSS variables from a color palette
 * @param colors - Color palette
 * @returns CSS variable declarations
 */
function generateColorVariables(colors: ColorPalette): string[] {
  const vars: string[] = [];

  for (const [key, varName] of Object.entries(COLOR_VAR_MAP)) {
    const value = colors[key as keyof ColorPalette];
    if (value !== undefined) {
      vars.push(`${varName}: ${value};`);
    }
  }

  return vars;
}

/**
 * Generate CSS variables from typography tokens
 * @param typography - Typography tokens
 * @returns CSS variable declarations
 */
function generateTypographyVariables(typography: Typography): string[] {
  const vars: string[] = [];

  for (const [key, varName] of Object.entries(TYPOGRAPHY_VAR_MAP)) {
    const value = typography[key as keyof Typography];
    if (value !== undefined) {
      vars.push(`${varName}: ${value};`);
    }
  }

  return vars;
}

/**
 * Generate CSS variables from spacing tokens
 * @param spacing - Spacing tokens
 * @returns CSS variable declarations
 */
function generateSpacingVariables(spacing: Spacing): string[] {
  const vars: string[] = [];

  for (const [key, varName] of Object.entries(SPACING_VAR_MAP)) {
    const value = spacing[key as keyof Spacing];
    if (value !== undefined) {
      vars.push(`${varName}: ${value};`);
    }
  }

  return vars;
}

/**
 * Generate CSS variables from effects tokens
 * @param effects - Effects tokens
 * @returns CSS variable declarations
 */
function generateEffectsVariables(effects: Effects): string[] {
  const vars: string[] = [];

  for (const [key, varName] of Object.entries(EFFECTS_VAR_MAP)) {
    const value = effects[key as keyof Effects];
    if (value !== undefined) {
      vars.push(`${varName}: ${value};`);
    }
  }

  return vars;
}

/**
 * Generate a complete CSS stylesheet from theme tokens
 *
 * Creates CSS with:
 * - :root selector for light mode (and non-color tokens)
 * - .dark selector for dark mode colors
 *
 * @param tokens - Theme tokens
 * @returns Complete CSS string
 */
export function themeTokensToCSS(tokens: ThemeTokens): string {
  const lightColorVars = generateColorVariables(tokens.colors.light);
  const darkColorVars = generateColorVariables(tokens.colors.dark);

  const typographyVars = tokens.typography
    ? generateTypographyVariables(tokens.typography)
    : [];
  const spacingVars = tokens.spacing
    ? generateSpacingVariables(tokens.spacing)
    : [];
  const effectsVars = tokens.effects
    ? generateEffectsVariables(tokens.effects)
    : [];

  // Combine non-color variables (these don't change between light/dark)
  const sharedVars = [...typographyVars, ...spacingVars, ...effectsVars];

  // Build the CSS
  const css = `
/* Theme variables generated by Quilltap Theme System */

:root {
  /* Light mode colors */
  ${lightColorVars.join('\n  ')}

  /* Typography */
  ${typographyVars.length > 0 ? typographyVars.join('\n  ') : '/* Using defaults */'}

  /* Spacing & Radius */
  ${spacingVars.length > 0 ? spacingVars.join('\n  ') : '/* Using defaults */'}

  /* Effects */
  ${effectsVars.length > 0 ? effectsVars.join('\n  ') : '/* Using defaults */'}
}

.dark {
  /* Dark mode colors */
  ${darkColorVars.join('\n  ')}
}
`.trim();

  return css;
}

/**
 * Generate CSS for a specific color mode only
 *
 * @param tokens - Theme tokens
 * @param mode - Color mode ('light' or 'dark')
 * @returns CSS variable declarations (without selector)
 */
export function themeColorsToCSS(tokens: ThemeTokens, mode: 'light' | 'dark'): string {
  const colors = mode === 'light' ? tokens.colors.light : tokens.colors.dark;
  const vars = generateColorVariables(colors);
  return vars.join('\n  ');
}

/**
 * Generate inline style object from theme tokens for a specific mode
 * Useful for React style props
 *
 * @param tokens - Theme tokens
 * @param mode - Color mode
 * @returns Object with CSS variable names as keys
 */
export function themeTokensToStyleObject(
  tokens: ThemeTokens,
  mode: 'light' | 'dark'
): Record<string, string> {
  const colors = mode === 'light' ? tokens.colors.light : tokens.colors.dark;
  const style: Record<string, string> = {};

  // Add color variables
  for (const [key, varName] of Object.entries(COLOR_VAR_MAP)) {
    const value = colors[key as keyof ColorPalette];
    if (value !== undefined) {
      style[varName] = value;
    }
  }

  // Add typography variables
  if (tokens.typography) {
    for (const [key, varName] of Object.entries(TYPOGRAPHY_VAR_MAP)) {
      const value = tokens.typography[key as keyof Typography];
      if (value !== undefined) {
        style[varName] = value;
      }
    }
  }

  // Add spacing variables
  if (tokens.spacing) {
    for (const [key, varName] of Object.entries(SPACING_VAR_MAP)) {
      const value = tokens.spacing[key as keyof Spacing];
      if (value !== undefined) {
        style[varName] = value;
      }
    }
  }

  // Add effects variables
  if (tokens.effects) {
    for (const [key, varName] of Object.entries(EFFECTS_VAR_MAP)) {
      const value = tokens.effects[key as keyof Effects];
      if (value !== undefined) {
        style[varName] = value;
      }
    }
  }

  return style;
}

// ============================================================================
// THEME MERGING
// ============================================================================

/**
 * Deep merge two theme token objects
 * The override values take precedence over base values
 *
 * @param base - Base theme tokens
 * @param override - Override theme tokens (partial)
 * @returns Merged theme tokens
 */
export function mergeThemeTokens(
  base: ThemeTokens,
  override: Partial<ThemeTokens>
): ThemeTokens {
  const merged: ThemeTokens = {
    colors: {
      light: { ...base.colors.light, ...override.colors?.light },
      dark: { ...base.colors.dark, ...override.colors?.dark },
    },
  };

  // Merge typography if provided
  if (base.typography || override.typography) {
    merged.typography = {
      ...base.typography,
      ...override.typography,
    } as Typography;
  }

  // Merge spacing if provided
  if (base.spacing || override.spacing) {
    merged.spacing = {
      ...base.spacing,
      ...override.spacing,
    } as Spacing;
  }

  // Merge effects if provided
  if (base.effects || override.effects) {
    merged.effects = {
      ...base.effects,
      ...override.effects,
    } as Effects;
  }

  return merged;
}

/**
 * Merge a partial theme with the default theme
 *
 * @param partial - Partial theme tokens
 * @returns Complete theme tokens with defaults filled in
 */
export function mergeWithDefaultTheme(partial: Partial<ThemeTokens>): ThemeTokens {
  return mergeThemeTokens(DEFAULT_THEME_TOKENS, partial);
}

// ============================================================================
// THEME VALIDATION & COMPARISON
// ============================================================================

/**
 * Check if two color palettes are equal
 *
 * @param a - First palette
 * @param b - Second palette
 * @returns True if palettes are equal
 */
export function colorPalettesEqual(a: ColorPalette, b: ColorPalette): boolean {
  const keys = Object.keys(COLOR_VAR_MAP) as Array<keyof ColorPalette>;
  return keys.every(key => a[key] === b[key]);
}

/**
 * Check if two theme token objects are equal
 *
 * @param a - First theme
 * @param b - Second theme
 * @returns True if themes are equal
 */
export function themeTokensEqual(a: ThemeTokens, b: ThemeTokens): boolean {
  // Compare colors
  if (!colorPalettesEqual(a.colors.light, b.colors.light)) return false;
  if (!colorPalettesEqual(a.colors.dark, b.colors.dark)) return false;

  // Compare other token categories (shallow comparison)
  if (JSON.stringify(a.typography) !== JSON.stringify(b.typography)) return false;
  if (JSON.stringify(a.spacing) !== JSON.stringify(b.spacing)) return false;
  if (JSON.stringify(a.effects) !== JSON.stringify(b.effects)) return false;

  return true;
}

/**
 * Get the differences between two theme token objects
 *
 * @param base - Base theme
 * @param compare - Theme to compare
 * @returns Object describing differences
 */
export function getThemeDifferences(
  base: ThemeTokens,
  compare: ThemeTokens
): {
  lightColors: Array<{ key: string; base: string; compare: string }>;
  darkColors: Array<{ key: string; base: string; compare: string }>;
  typography: Array<{ key: string; base: string; compare: string }>;
  spacing: Array<{ key: string; base: string; compare: string }>;
  effects: Array<{ key: string; base: string; compare: string }>;
} {
  const differences = {
    lightColors: [] as Array<{ key: string; base: string; compare: string }>,
    darkColors: [] as Array<{ key: string; base: string; compare: string }>,
    typography: [] as Array<{ key: string; base: string; compare: string }>,
    spacing: [] as Array<{ key: string; base: string; compare: string }>,
    effects: [] as Array<{ key: string; base: string; compare: string }>,
  };

  // Compare light colors
  for (const key of Object.keys(COLOR_VAR_MAP) as Array<keyof ColorPalette>) {
    const baseVal = base.colors.light[key];
    const compareVal = compare.colors.light[key];
    if (baseVal !== compareVal && baseVal !== undefined && compareVal !== undefined) {
      differences.lightColors.push({ key, base: baseVal, compare: compareVal });
    }
  }

  // Compare dark colors
  for (const key of Object.keys(COLOR_VAR_MAP) as Array<keyof ColorPalette>) {
    const baseVal = base.colors.dark[key];
    const compareVal = compare.colors.dark[key];
    if (baseVal !== compareVal && baseVal !== undefined && compareVal !== undefined) {
      differences.darkColors.push({ key, base: baseVal, compare: compareVal });
    }
  }

  // Compare typography
  if (base.typography && compare.typography) {
    for (const key of Object.keys(TYPOGRAPHY_VAR_MAP) as Array<keyof Typography>) {
      const baseVal = base.typography[key];
      const compareVal = compare.typography[key];
      if (baseVal !== compareVal) {
        differences.typography.push({ key, base: baseVal || '', compare: compareVal || '' });
      }
    }
  }

  // Compare spacing
  if (base.spacing && compare.spacing) {
    for (const key of Object.keys(SPACING_VAR_MAP) as Array<keyof Spacing>) {
      const baseVal = base.spacing[key];
      const compareVal = compare.spacing[key];
      if (baseVal !== compareVal) {
        differences.spacing.push({ key, base: baseVal || '', compare: compareVal || '' });
      }
    }
  }

  // Compare effects
  if (base.effects && compare.effects) {
    for (const key of Object.keys(EFFECTS_VAR_MAP) as Array<keyof Effects>) {
      const baseVal = base.effects[key];
      const compareVal = compare.effects[key];
      if (baseVal !== compareVal) {
        differences.effects.push({ key, base: baseVal || '', compare: compareVal || '' });
      }
    }
  }

  return differences;
}

// ============================================================================
// CSS VARIABLE MAPPING EXPORTS
// ============================================================================

export {
  COLOR_VAR_MAP,
  TYPOGRAPHY_VAR_MAP,
  SPACING_VAR_MAP,
  EFFECTS_VAR_MAP,
};
