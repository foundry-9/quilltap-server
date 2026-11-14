/**
 * Theme Utilities
 *
 * Utility functions for theme handling, DOM manipulation, and system preference detection.
 */

import { DEFAULT_THEME_TOKENS } from '@/lib/themes/default-tokens';
import type { ThemeTokens, ColorMode } from '@/lib/themes/types';
import { THEME_CHOICES } from '@/lib/themes/registry/choices';
import type { ThemeSummary, ThemeTokensResponse, ThemesListResponse, ThemeFont, ThemeIcon, SubsystemOverride, ThemeFeatureFlags } from './types';

/**
 * Resolve the actual color mode based on preference and system settings
 */
export function resolveColorMode(
  colorMode: ColorMode,
  systemPrefersDark: boolean
): 'light' | 'dark' {
  if (colorMode === 'system') {
    return systemPrefersDark ? 'dark' : 'light';
  }
  return colorMode;
}

/**
 * App-owned theme behaviour a theme can switch on (Calliope Live, Spec A).
 * Each is an attribute on <html> that keys rules in
 * app/styles/qt-components/_base.css:
 * - `pageBackground` → `data-qt-page-background`: paint --qt-page-background-image
 *   behind the app and make the page surfaces transparent over it;
 * - `focusRing` → `data-qt-focus-ring`: the app's :focus-visible ring;
 * - `scrollbar` → `data-qt-scrollbar`: WebKit scrollbar styling from the
 *   --qt-scrollbar-* tokens.
 * A version 1 theme switches none of them on, so its own rules are untouched.
 */
export interface ThemeDomFeatures {
  pageBackground?: boolean;
  focusRing?: boolean;
  scrollbar?: boolean;
}

export const THEME_FEATURE_ATTRIBUTES: Readonly<Record<keyof ThemeDomFeatures, string>> = {
  pageBackground: 'data-qt-page-background',
  focusRing: 'data-qt-focus-ring',
  scrollbar: 'data-qt-scrollbar',
};

/**
 * Apply theme colors and mode to the DOM
 */
export function applyThemeToDom(
  resolvedColorMode: 'light' | 'dark',
  activeThemeId: string | null,
  features: ThemeDomFeatures = {},
  choices: Readonly<Record<string, string>> = {}
): void {
  if (typeof window === 'undefined') return;

  const root = document.documentElement;

  // Apply dark/light class
  if (resolvedColorMode === 'dark') {
    root.classList.add('dark');
    root.classList.remove('light');
  } else {
    root.classList.add('light');
    root.classList.remove('dark');
  }

  // Set data attribute for theme-aware CSS selectors
  root.setAttribute('data-theme', activeThemeId ?? 'default');
  root.setAttribute('data-color-mode', resolvedColorMode);

  for (const [feature, attribute] of Object.entries(THEME_FEATURE_ATTRIBUTES) as Array<[keyof ThemeDomFeatures, string]>) {
    if (features[feature]) root.setAttribute(attribute, '');
    else root.removeAttribute(attribute);
  }

  // Choices (density, …): data-qt-<name>="<option>". The default option is
  // the generated defaults, so it needs no attribute; neither does a theme
  // that picks nothing.
  for (const choice of THEME_CHOICES) {
    const attribute = `data-qt-${choice.name}`;
    const option = choices[choice.name];
    if (option && option !== choice.default && choice.options.includes(option)) root.setAttribute(attribute, option);
    else root.removeAttribute(attribute);
  }
}

/**
 * Set up system preference listener
 * Returns cleanup function
 */
export function setupSystemPreferenceListener(
  onChange: (prefersDark: boolean) => void
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

  const handler = (e: MediaQueryListEvent | Event) => {
    if (e instanceof MediaQueryListEvent) {
      onChange(e.matches);
    }
  };

  mediaQuery.addEventListener('change', handler);

  return () => {
    mediaQuery.removeEventListener('change', handler);
  };
}

/**
 * Get current system dark mode preference
 */
export function getSystemDarkModePreference(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** A theme as the provider applies it: version 1 tokens, or version 2 compiled CSS. */
export type LoadedThemeTokens =
  | {
      formatVersion: 1;
      tokens: ThemeTokens;
      fonts: ThemeFont[];
      icons: ThemeIcon[];
      cssOverrides: string | undefined;
      subsystems: Record<string, SubsystemOverride> | null;
    }
  | {
      formatVersion: 2;
      css: string;
      choices: Record<string, string>;
      features: ThemeFeatureFlags;
      subsystems: Record<string, SubsystemOverride> | null;
    };

/**
 * Fetch theme tokens from API
 */
export async function fetchThemeTokens(themeId: string): Promise<LoadedThemeTokens | null> {
  try {
    const response = await fetch(`/api/v1/themes/${themeId}?action=tokens`);
    if (response.ok) {
      const data: ThemeTokensResponse = await response.json();
      if (data.formatVersion === 2) {
        return {
          formatVersion: 2,
          css: data.css,
          choices: data.choices || {},
          features: data.features,
          subsystems: data.subsystems || null,
        };
      }
      return {
        formatVersion: 1,
        tokens: data.tokens,
        fonts: data.fonts || [],
        icons: data.icons || [],
        cssOverrides: data.cssOverrides || undefined,
        subsystems: data.subsystems || null,
      };
    } else if (response.status === 404) {
      return null;
    } else {
      throw new Error(`Failed to load theme tokens: ${response.status}`);
    }
  } catch {
    return null;
  }
}

/**
 * Fetch available themes list from API
 */
export async function fetchAvailableThemes(): Promise<ThemeSummary[]> {
  try {
    const response = await fetch('/api/v1/themes');
    if (response.ok) {
      const data: ThemesListResponse = await response.json();
      // Filter out the default theme since it's handled separately in the UI
      return (data.themes || []).filter((t) => !t.isDefault);
    } else {
      throw new Error(`Failed to load themes: ${response.status}`);
    }
  } catch {
    // Return empty list on error - themes list is non-critical
    return [];
  }
}

/**
 * Fetch user's theme preference from API
 */
export async function fetchThemePreference(): Promise<{
  activeThemeId: string | null;
  colorMode: ColorMode;
  showNavThemeSelector: boolean;
} | null> {
  try {
    const response = await fetch('/api/v1/user/profile?action=theme-preference');
    if (response.ok) {
      const json = await response.json();
      const preference = json.data || json;
      return {
        activeThemeId: preference.activeThemeId ?? null,
        colorMode: preference.colorMode ?? 'system',
        showNavThemeSelector: preference.showNavThemeSelector ?? false,
      };
    } else if (response.status === 401) {
      // Not authenticated, return null
      return null;
    } else {
      throw new Error(`Failed to load preference: ${response.status}`);
    }
  } catch (err) {
    throw err;
  }
}

/**
 * Save theme preference to API
 */
export async function saveThemePreference(
  preference: Partial<{
    activeThemeId: string | null;
    colorMode: ColorMode;
    showNavThemeSelector: boolean;
  }>
): Promise<void> {
  try {
    const response = await fetch('/api/v1/user/profile?action=theme-preference', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(preference),
    });

    if (!response.ok) {
      throw new Error(`Failed to save preference: ${response.status}`);
    }
  } catch (err) {
    // Don't re-throw - preference will be saved on next attempt
  }
}

/**
 * Get default tokens
 */
export function getDefaultTokens(): ThemeTokens {
  return DEFAULT_THEME_TOKENS;
}
