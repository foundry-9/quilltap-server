/**
 * Default Theme Tokens — Professional Neutral
 *
 * Read from the theme token registry, which also generates the CSS defaults,
 * and serve as the fallback when no theme plugin is active. They represent the
 * "Default" theme that ships with Quilltap.
 *
 * Base hue: 225 (cool blue-gray) — neutral, precise, professional.
 * System font stack throughout — no decorative fonts.
 *
 * @module themes/default-tokens
 */

import type { ThemeTokens, Typography, Spacing, Effects, ColorPalette } from './types';
import { getThemeToken } from './registry';
import { COLOR_VAR_MAP, EFFECTS_VAR_MAP, SPACING_VAR_MAP, TYPOGRAPHY_VAR_MAP } from './utils';

/*
 * Every value here is read from the theme token registry (lib/themes/registry/),
 * the single source of truth that also generates app/styles/_theme-defaults.css
 * and _variables.css — so the tokens the default theme injects and the CSS
 * defaults cannot drift apart. The maps in ./utils name the variable each key
 * is emitted as.
 */

function registryValue(name: string, mode: 'light' | 'dark'): string {
  const token = getThemeToken(name);
  if (!token) {
    throw new Error(`Default theme token ${name} is not in the theme token registry`);
  }
  return mode === 'dark' && token.defaultDark !== undefined ? token.defaultDark : token.default;
}

function fromRegistry<K extends string>(map: Record<K, string>, mode: 'light' | 'dark'): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const key of Object.keys(map) as K[]) out[key] = registryValue(map[key], mode);
  return out;
}

/** Default light mode colors (cool blue-gray, hue 225). */
const DEFAULT_LIGHT_COLORS: ColorPalette = fromRegistry(COLOR_VAR_MAP, 'light');

/** Default dark mode colors: page (9%) → card (12%) → popover (14%). */
const DEFAULT_DARK_COLORS: ColorPalette = fromRegistry(COLOR_VAR_MAP, 'dark');

/** Default typography: system font stacks, the type scale. */
export const DEFAULT_TYPOGRAPHY: Typography = fromRegistry(TYPOGRAPHY_VAR_MAP, 'light');

/** Default radii and spacing steps. */
export const DEFAULT_SPACING: Spacing = fromRegistry(SPACING_VAR_MAP, 'light');

/** Default shadows, transitions and focus ring. */
export const DEFAULT_EFFECTS: Effects = fromRegistry(EFFECTS_VAR_MAP, 'light');


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
