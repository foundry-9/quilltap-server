'use client';

/**
 * Theme Provider Component
 *
 * React context provider for the Quilltap theming system.
 * Manages theme selection, color mode preferences, and applies
 * theme tokens as CSS variables.
 *
 * Features:
 * - Theme selection (default or plugin themes)
 * - Color mode (light/dark/system)
 * - System preference detection
 * - Persistent preferences via API
 * - CSS variable injection
 *
 * @module providers/theme/ThemeProvider
 */

import {
  createContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from 'react';
import { useSession } from 'next-auth/react';
import { clientLogger } from '@/lib/client-logger';
import { ThemeStyleInjector } from '@/components/providers/theme-style-injector';
import type { ThemeContextValue, ThemeProviderProps, ThemeFont, ThemeSummary } from './types';
import type { ColorMode } from '@/lib/themes/types';
import {
  resolveColorMode,
  applyThemeToDom,
  setupSystemPreferenceListener,
  getSystemDarkModePreference,
  fetchThemeTokens,
  fetchAvailableThemes,
  fetchThemePreference,
  saveThemePreference,
  getDefaultTokens,
} from './theme-utils';

/**
 * Theme context - exported for useTheme hook
 */
export const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * ThemeProvider Component
 *
 * Manages all theme state and provides it to the app via context.
 * Handles loading preferences from API, system preference detection,
 * and applying theme styles to the DOM.
 *
 * @param props - ThemeProviderProps
 * @returns JSX.Element
 */
export function ThemeProvider({
  children,
  initialPreference,
  initialTokens,
  initialCssOverrides,
}: ThemeProviderProps) {
  const { status } = useSession();

  // ============================================================================
  // STATE
  // ============================================================================

  const [activeThemeId, setActiveThemeId] = useState<string | null>(
    initialPreference?.activeThemeId ?? null
  );
  const [colorMode, setColorModeState] = useState<ColorMode>(
    initialPreference?.colorMode ?? 'system'
  );
  const [resolvedColorMode, setResolvedColorMode] = useState<'light' | 'dark'>('light');
  const [tokens, setTokens] = useState(initialTokens ?? getDefaultTokens());
  const [availableThemes, setAvailableThemes] = useState<ThemeSummary[]>([]);
  const [themeFonts, setThemeFonts] = useState<ThemeFont[]>([]);
  const [cssOverrides, setCssOverrides] = useState<string | undefined>(initialCssOverrides);
  const [showNavThemeSelector, setShowNavThemeSelectorState] = useState<boolean>(
    initialPreference?.showNavThemeSelector ?? false
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ============================================================================
  // SYSTEM PREFERENCE DETECTION
  // ============================================================================

  useEffect(() => {
    // Only run in browser
    if (typeof window === 'undefined') return;

    const updateResolvedMode = (systemPrefersDark: boolean) => {
      const resolved = resolveColorMode(colorMode, systemPrefersDark);
      setResolvedColorMode(resolved);
      clientLogger.debug('Theme: resolved color mode updated', {
        colorMode,
        systemPrefersDark,
        resolved,
      });
    };

    // Set initial value
    const systemPrefersDark = getSystemDarkModePreference();
    updateResolvedMode(systemPrefersDark);

    // Listen for system preference changes
    const cleanup = setupSystemPreferenceListener((prefersDark) => {
      updateResolvedMode(prefersDark);
    });

    return cleanup;
  }, [colorMode]);

  // ============================================================================
  // APPLY THEME TO DOM
  // ============================================================================

  useEffect(() => {
    applyThemeToDom(resolvedColorMode, activeThemeId);
  }, [resolvedColorMode, activeThemeId]);

  // ============================================================================
  // LOAD INITIAL DATA
  // ============================================================================

  const loadThemeTokens = useCallback(async (themeId: string) => {
    const result = await fetchThemeTokens(themeId);
    if (result) {
      setTokens(result.tokens);
      setThemeFonts(result.fonts);
      setCssOverrides(result.cssOverrides);
    } else {
      // Fall back to default tokens
      setTokens(getDefaultTokens());
      setThemeFonts([]);
      setCssOverrides(undefined);
    }
  }, []);

  const loadAvailableThemes = useCallback(async () => {
    const themes = await fetchAvailableThemes();
    setAvailableThemes(themes);
  }, []);

  const loadPreference = useCallback(async () => {
    // Don't load if not authenticated
    if (status !== 'authenticated') {
      clientLogger.debug('Theme: skipping preference load (not authenticated)');
      setIsLoading(false);
      return;
    }

    try {
      const preference = await fetchThemePreference();
      if (preference) {
        setActiveThemeId(preference.activeThemeId);
        setColorModeState(preference.colorMode);
        setShowNavThemeSelectorState(preference.showNavThemeSelector);

        // If a theme is selected, load its tokens
        if (preference.activeThemeId) {
          await loadThemeTokens(preference.activeThemeId);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    }
  }, [status, loadThemeTokens]);

  // Load on mount and auth state change
  useEffect(() => {
    const initialize = async () => {
      setIsLoading(true);
      setError(null);

      // Load themes list (doesn't require auth)
      await loadAvailableThemes();

      // Load user preference (requires auth)
      if (status !== 'loading') {
        await loadPreference();
      }

      setIsLoading(false);
    };

    initialize();
  }, [status, loadAvailableThemes, loadPreference]);

  // ============================================================================
  // ACTIONS
  // ============================================================================

  const setTheme = useCallback(
    async (themeId: string | null) => {
      clientLogger.debug('Theme: setting theme', { themeId });

      // Update local state immediately for responsiveness
      setActiveThemeId(themeId);

      // Load new theme tokens and fonts
      if (themeId) {
        await loadThemeTokens(themeId);
      } else {
        setTokens(getDefaultTokens());
        setThemeFonts([]);
        setCssOverrides(undefined);
      }

      // Persist to server
      if (status === 'authenticated') {
        await saveThemePreference({ activeThemeId: themeId });
      }
    },
    [status, loadThemeTokens]
  );

  const setColorMode = useCallback(
    async (mode: ColorMode) => {
      clientLogger.debug('Theme: setting color mode', { mode });

      // Update local state immediately
      setColorModeState(mode);

      // Persist to server
      if (status === 'authenticated') {
        await saveThemePreference({ colorMode: mode });
      }
    },
    [status]
  );

  const refreshThemes = useCallback(async () => {
    await loadAvailableThemes();
  }, [loadAvailableThemes]);

  const setShowNavThemeSelector = useCallback(
    async (show: boolean) => {
      clientLogger.debug('Theme: setting showNavThemeSelector', { show });

      // Update local state immediately
      setShowNavThemeSelectorState(show);

      // Persist to server
      if (status === 'authenticated') {
        await saveThemePreference({ showNavThemeSelector: show });
      }
    },
    [status]
  );

  // ============================================================================
  // CONTEXT VALUE
  // ============================================================================

  const value = useMemo<ThemeContextValue>(
    () => ({
      activeThemeId,
      colorMode,
      resolvedColorMode,
      tokens,
      availableThemes,
      isLoading,
      error,
      showNavThemeSelector,
      setTheme,
      setColorMode,
      setShowNavThemeSelector,
      refreshThemes,
    }),
    [
      activeThemeId,
      colorMode,
      resolvedColorMode,
      tokens,
      availableThemes,
      isLoading,
      error,
      showNavThemeSelector,
      setTheme,
      setColorMode,
      setShowNavThemeSelector,
      refreshThemes,
    ]
  );

  return (
    <ThemeContext.Provider value={value}>
      <ThemeStyleInjector
        tokens={tokens}
        mode={resolvedColorMode}
        fonts={themeFonts}
        themeId={activeThemeId}
        cssOverrides={cssOverrides}
      />
      {children}
    </ThemeContext.Provider>
  );
}
