'use client';

/**
 * Theme Provider Component
 *
 * React context provider for the Quilltap theming system.
 * Manages theme selection and color mode preferences, and injects the active
 * theme's CSS (compiled server-side; the default theme injects none).
 *
 * Features:
 * - Theme selection (default or a bundle theme)
 * - Color mode (light/dark/system)
 * - System preference detection
 * - Persistent preferences via API
 * - A one-time notice when the preferred theme can no longer be worn
 *
 * @module providers/theme/ThemeProvider
 */

import {
  createContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { useSession } from '@/components/providers/session-provider';
import { ThemeStyleInjector } from '@/components/providers/theme-style-injector';
import type { ThemeContextValue, ThemeProviderProps, ThemeSummary, SubsystemOverride } from './types';
import type { ColorMode } from '@/lib/themes/types';
import type { RefusedTheme } from '@/lib/themes/refused';
import { showWarningToast } from '@/lib/toast';
import {
  resolveColorMode,
  applyThemeToDom,
  type ThemeDomFeatures,
  setupSystemPreferenceListener,
  getSystemDarkModePreference,
  fetchThemeTokens,
  fetchAvailableThemes,
  fetchThemePreference,
  saveThemePreference,
} from './theme-utils';

/** The notice shown when the preferred theme is not registered. */
function fallbackNotice(themeId: string, refused: RefusedTheme | undefined): string {
  if (refused) return `${refused.message} Quilltap has returned to its Default attire for the present.`;
  return `The theme “${themeId}” could not be found in the wardrobe, so Quilltap has returned to its Default attire for the present.`;
}

const FALLBACK_NOTICE_KEY = 'quilltap.themeFallbackNoticed';

/**
 * Say once (per browser, per theme id) that the preferred theme could not be
 * worn. Storage may be unavailable; then the notice simply shows each load.
 */
function noticeFallbackOnce(themeId: string, refused: RefusedTheme | undefined): void {
  let seen: string[] = [];
  try {
    seen = JSON.parse(window.localStorage.getItem(FALLBACK_NOTICE_KEY) || '[]');
    if (!Array.isArray(seen)) seen = [];
  } catch {
    seen = [];
  }
  if (seen.includes(themeId)) return;
  showWarningToast(fallbackNotice(themeId, refused), 10000);
  try {
    window.localStorage.setItem(FALLBACK_NOTICE_KEY, JSON.stringify([...seen, themeId]));
  } catch {
    // Storage unavailable: the notice shows again next time.
  }
}

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
  const [availableThemes, setAvailableThemes] = useState<ThemeSummary[]>([]);
  const [defaultTheme, setDefaultTheme] = useState<ThemeSummary | null>(null);
  const [refusedThemes, setRefusedThemes] = useState<RefusedTheme[]>([]);
  // The active theme: compiled CSS, the app-owned features it switches on, its choices.
  const [compiledCss, setCompiledCss] = useState<string | null>(null);
  // Bumped whenever the injected CSS changes, so renderers that bake theme
  // colours into their output (diagrams) can key their caches on it.
  const [themeRevision, setThemeRevision] = useState(0);
  const lastCssRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastCssRef.current === compiledCss) return;
    lastCssRef.current = compiledCss;
    setThemeRevision((n) => n + 1);
  }, [compiledCss]);
  const [themeFeatures, setThemeFeatures] = useState<ThemeDomFeatures>({});
  const [themeChoices, setThemeChoices] = useState<Record<string, string>>({});
  const [subsystems, setSubsystems] = useState<Record<string, SubsystemOverride> | null>(null);
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
    applyThemeToDom(resolvedColorMode, activeThemeId, themeFeatures, themeChoices);
  }, [resolvedColorMode, activeThemeId, themeFeatures, themeChoices]);

  // ============================================================================
  // LOAD INITIAL DATA
  // ============================================================================

  const clearTheme = useCallback(() => {
    setCompiledCss(null);
    setThemeFeatures({});
    setThemeChoices({});
    setSubsystems(null);
  }, []);

  /** Load a theme's CSS; false when the theme is not registered. */
  const loadThemeTokens = useCallback(async (themeId: string): Promise<boolean> => {
    const result = await fetchThemeTokens(themeId);
    if (!result) {
      clearTheme();
      return false;
    }
    setCompiledCss(result.css || null);
    setThemeFeatures(result.features);
    setThemeChoices(result.choices);
    setSubsystems(result.subsystems);
    return true;
  }, [clearTheme]);

  const loadAvailableThemes = useCallback(async () => {
    const { themes, defaultTheme: defaultEntry, refused } = await fetchAvailableThemes();
    setAvailableThemes(themes);
    setDefaultTheme(defaultEntry);
    setRefusedThemes(refused);
    return refused;
  }, []);

  const loadPreference = useCallback(async (refused: RefusedTheme[]) => {
    // Don't load if not authenticated
    if (status !== 'authenticated') {
      setIsLoading(false);
      return;
    }

    try {
      const preference = await fetchThemePreference();
      if (preference) {
        setActiveThemeId(preference.activeThemeId);
        setColorModeState(preference.colorMode);
        setShowNavThemeSelectorState(preference.showNavThemeSelector);

        // If a theme is selected, load it; if it cannot be worn (refused or
        // gone), the default stands in and the operator is told once.
        if (preference.activeThemeId && preference.activeThemeId !== 'default') {
          const worn = await loadThemeTokens(preference.activeThemeId);
          if (!worn) {
            setActiveThemeId(null);
            noticeFallbackOnce(preference.activeThemeId, refused.find(r => r.id === preference.activeThemeId));
          }
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
      const refused = await loadAvailableThemes();

      // Load user preference (requires auth)
      if (status !== 'loading') {
        await loadPreference(refused);
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
      // Update local state immediately for responsiveness
      setActiveThemeId(themeId);

      // Load the new theme's CSS
      if (themeId) {
        await loadThemeTokens(themeId);
      } else {
        clearTheme();
      }

      // Persist to server
      if (status === 'authenticated') {
        await saveThemePreference({ activeThemeId: themeId });
      }
    },
    [status, loadThemeTokens, clearTheme]
  );

  const setColorMode = useCallback(
    async (mode: ColorMode) => {
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
      availableThemes,
      defaultTheme,
      refusedThemes,
      themeRevision,
      isLoading,
      error,
      showNavThemeSelector,
      subsystems,
      setTheme,
      setColorMode,
      setShowNavThemeSelector,
      refreshThemes,
    }),
    [
      activeThemeId,
      colorMode,
      resolvedColorMode,
      availableThemes,
      defaultTheme,
      refusedThemes,
      themeRevision,
      isLoading,
      error,
      showNavThemeSelector,
      subsystems,
      setTheme,
      setColorMode,
      setShowNavThemeSelector,
      refreshThemes,
    ]
  );

  return (
    <ThemeContext.Provider value={value}>
      <ThemeStyleInjector
        mode={resolvedColorMode}
        themeId={activeThemeId}
        compiledCss={compiledCss}
      />
      {children}
    </ThemeContext.Provider>
  );
}
