/**
 * Theme Utilities
 *
 * Utility functions for theme handling, DOM manipulation, and system preference detection.
 */

import type { ColorMode } from '@/lib/themes/types';
import type { RefusedTheme } from '@/lib/themes/refused';
import { THEME_CHOICES } from '@/lib/themes/registry/choices';
import type { ThemeSummary, ThemeTokensResponse, ThemesListResponse, SubsystemOverride, ThemeFeatureFlags } from './types';

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
 * The default theme switches none of them on.
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

/** A theme as the provider applies it: compiled CSS, features, choices. */
export interface LoadedThemeTokens {
  css: string;
  choices: Record<string, string>;
  features: ThemeFeatureFlags;
  subsystems: Record<string, SubsystemOverride> | null;
}

/**
 * Fetch a theme's compiled CSS from the API. Null when the theme is not
 * registered (uninstalled, or refused as made for an earlier Quilltap).
 */
export async function fetchThemeTokens(themeId: string): Promise<LoadedThemeTokens | null> {
  try {
    const response = await fetch(`/api/v1/themes/${encodeURIComponent(themeId)}?action=tokens`);
    if (response.ok) {
      const data: ThemeTokensResponse = await response.json();
      return {
        css: data.css || '',
        choices: data.choices || {},
        features: data.features,
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
export async function fetchAvailableThemes(): Promise<{
  themes: ThemeSummary[];
  defaultTheme: ThemeSummary | null;
  refused: RefusedTheme[];
}> {
  try {
    const response = await fetch('/api/v1/themes');
    if (response.ok) {
      const data: ThemesListResponse = await response.json();
      const all = data.themes || [];
      return {
        // The default theme is handled separately in the UI
        themes: all.filter((t) => !t.isDefault),
        defaultTheme: all.find((t) => t.isDefault) ?? null,
        refused: data.refused || [],
      };
    } else {
      throw new Error(`Failed to load themes: ${response.status}`);
    }
  } catch {
    // Return empty lists on error - themes list is non-critical
    return { themes: [], defaultTheme: null, refused: [] };
  }
}

/**
 * Fetch user's theme preference from API
 */
export async function fetchThemePreference(): Promise<{
  activeThemeId: string | null;
  colorMode: ColorMode;
} | null> {
  try {
    const response = await fetch('/api/v1/user/profile?action=theme-preference');
    if (response.ok) {
      const json = await response.json();
      const preference = json.data || json;
      return {
        activeThemeId: preference.activeThemeId ?? null,
        colorMode: preference.colorMode ?? 'system',
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
 * Save theme preference to API. Throws when the save fails.
 */
export async function saveThemePreference(
  preference: Partial<{
    activeThemeId: string | null;
    colorMode: ColorMode;
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
    // Surface the failure; the caller tells the operator the preference was not kept.
    throw err instanceof Error ? err : new Error(String(err));
  }
}
