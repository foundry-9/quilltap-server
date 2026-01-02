/**
 * Theme Utilities
 *
 * Utility functions for theme handling, DOM manipulation, and system preference detection.
 */

import { clientLogger } from '@/lib/client-logger';
import { DEFAULT_THEME_TOKENS } from '@/lib/themes/default-tokens';
import type { ThemeTokens, ColorMode } from '@/lib/themes/types';
import type { ThemeSummary, ThemeTokensResponse, ThemesListResponse, ThemeFont } from './types';

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
 * Apply theme colors and mode to the DOM
 */
export function applyThemeToDom(
  resolvedColorMode: 'light' | 'dark',
  activeThemeId: string | null
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

/**
 * Fetch theme tokens from API
 */
export async function fetchThemeTokens(
  themeId: string
): Promise<{
  tokens: ThemeTokens;
  fonts: ThemeFont[];
  cssOverrides: string | undefined;
} | null> {
  try {
    const response = await fetch(`/api/themes/${themeId}/tokens`);
    if (response.ok) {
      const data: ThemeTokensResponse = await response.json();
      return {
        tokens: data.tokens,
        fonts: data.fonts || [],
        cssOverrides: data.cssOverrides || undefined,
      };
    } else if (response.status === 404) {
      clientLogger.warn('Theme: theme not found, using default', { themeId });
      return null;
    } else {
      throw new Error(`Failed to load theme tokens: ${response.status}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    clientLogger.warn('Theme: failed to load theme tokens', { themeId, error: message });
    return null;
  }
}

/**
 * Fetch available themes list from API
 */
export async function fetchAvailableThemes(): Promise<ThemeSummary[]> {
  try {
    const response = await fetch('/api/themes');
    if (response.ok) {
      const data: ThemesListResponse = await response.json();
      // Filter out the default theme since it's handled separately in the UI
      return (data.themes || []).filter((t) => !t.isDefault);
    } else {
      throw new Error(`Failed to load themes: ${response.status}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    clientLogger.warn('Theme: failed to load available themes', { error: message });
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
    const response = await fetch('/api/theme-preference');
    if (response.ok) {
      const preference = await response.json();
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
    const message = err instanceof Error ? err.message : String(err);
    clientLogger.warn('Theme: failed to load preference', { error: message });
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
    const response = await fetch('/api/theme-preference', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(preference),
    });

    if (!response.ok) {
      throw new Error(`Failed to save preference: ${response.status}`);
    }

    clientLogger.info('Theme: preference saved', preference);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    clientLogger.warn('Theme: failed to save preference', { error: message });
    // Don't re-throw - preference will be saved on next attempt
  }
}

/**
 * Get default tokens
 */
export function getDefaultTokens(): ThemeTokens {
  return DEFAULT_THEME_TOKENS;
}
