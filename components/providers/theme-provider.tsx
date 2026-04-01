"use client";

/**
 * Theme Provider
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
 * @module providers/theme-provider
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import { useSession } from 'next-auth/react';
import { clientLogger } from '@/lib/client-logger';
import type { ThemeTokens, ColorMode, ThemePreference } from '@/lib/themes/types';
import { DEFAULT_THEME_TOKENS } from '@/lib/themes/default-tokens';
import { ThemeStyleInjector } from '@/components/providers/theme-style-injector';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Theme summary for display in theme picker
 */
export interface ThemeSummary {
  id: string;
  name: string;
  description?: string;
  preview?: string;
  supportsDarkMode: boolean;
  tags?: string[];
  isDefault?: boolean;
  previewColors?: {
    light: { background: string; primary: string; secondary: string; accent: string };
    dark: { background: string; primary: string; secondary: string; accent: string };
  };
}

/**
 * Theme context value provided to consumers
 */
export interface ThemeContextValue {
  /** Currently active theme ID (null = default theme) */
  activeThemeId: string | null;

  /** User's color mode preference */
  colorMode: ColorMode;

  /** Resolved color mode after applying system preference */
  resolvedColorMode: 'light' | 'dark';

  /** Current theme tokens (resolved from active theme or default) */
  tokens: ThemeTokens;

  /** List of available themes */
  availableThemes: ThemeSummary[];

  /** Whether theme data is still loading */
  isLoading: boolean;

  /** Any error that occurred during theme loading */
  error: string | null;

  /** Whether to show theme selector in the navigation bar */
  showNavThemeSelector: boolean;

  /** Set the active theme by ID (null for default) */
  setTheme: (themeId: string | null) => Promise<void>;

  /** Set the color mode preference */
  setColorMode: (mode: ColorMode) => Promise<void>;

  /** Set whether to show theme selector in the navigation bar */
  setShowNavThemeSelector: (show: boolean) => Promise<void>;

  /** Refresh available themes list */
  refreshThemes: () => Promise<void>;
}

// ============================================================================
// CONTEXT
// ============================================================================

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ============================================================================
// PROVIDER COMPONENT
// ============================================================================

interface ThemeProviderProps {
  children: ReactNode;
  /** Initial theme preference (for SSR hydration) */
  initialPreference?: ThemePreference;
  /** Initial tokens (for SSR hydration) */
  initialTokens?: ThemeTokens;
  /** Initial CSS overrides (for SSR hydration) */
  initialCssOverrides?: string;
}

export function ThemeProvider({
  children,
  initialPreference,
  initialTokens,
  initialCssOverrides,
}: ThemeProviderProps) {
  const { status } = useSession();

  // Theme state
  const [activeThemeId, setActiveThemeId] = useState<string | null>(
    initialPreference?.activeThemeId ?? null
  );
  const [colorMode, setColorModeState] = useState<ColorMode>(
    initialPreference?.colorMode ?? 'system'
  );
  const [resolvedColorMode, setResolvedColorMode] = useState<'light' | 'dark'>('light');
  const [tokens, setTokens] = useState<ThemeTokens>(
    initialTokens ?? DEFAULT_THEME_TOKENS
  );
  const [availableThemes, setAvailableThemes] = useState<ThemeSummary[]>([]);
  const [themeFonts, setThemeFonts] = useState<Array<{
    family: string;
    src: string;
    weight?: string;
    style?: string;
    display?: 'auto' | 'block' | 'swap' | 'fallback' | 'optional';
  }>>([]);
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

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const updateResolvedMode = () => {
      let resolved: 'light' | 'dark';

      if (colorMode === 'system') {
        resolved = mediaQuery.matches ? 'dark' : 'light';
      } else {
        resolved = colorMode;
      }

      setResolvedColorMode(resolved);
      clientLogger.debug('Theme: resolved color mode updated', {
        colorMode,
        systemPrefersDark: mediaQuery.matches,
        resolved,
      });
    };

    // Set initial value
    updateResolvedMode();

    // Listen for system preference changes
    const handler = () => updateResolvedMode();
    mediaQuery.addEventListener('change', handler);

    return () => {
      mediaQuery.removeEventListener('change', handler);
    };
  }, [colorMode]);

  // ============================================================================
  // APPLY THEME TO DOM
  // ============================================================================

  useEffect(() => {
    // Only run in browser
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

    clientLogger.debug('Theme: applied to DOM', {
      activeThemeId,
      resolvedColorMode,
      htmlClasses: root.classList.toString(),
    });
  }, [resolvedColorMode, activeThemeId]);

  // ============================================================================
  // LOAD INITIAL DATA
  // ============================================================================

  const loadThemeTokens = useCallback(async (themeId: string) => {
    try {
      clientLogger.debug('Theme: loading theme tokens', { themeId });

      const response = await fetch(`/api/themes/${themeId}/tokens`);
      if (response.ok) {
        const data = await response.json();
        // API returns { tokens, fonts, cssOverrides }
        setTokens(data.tokens);
        setThemeFonts(data.fonts || []);
        setCssOverrides(data.cssOverrides || undefined);

        clientLogger.debug('Theme: loaded theme tokens', {
          themeId,
          fontCount: data.fonts?.length || 0,
          hasCssOverrides: !!data.cssOverrides,
        });
      } else if (response.status === 404) {
        clientLogger.warn('Theme: theme not found, using default', { themeId });
        setTokens(DEFAULT_THEME_TOKENS);
        setThemeFonts([]);
        setCssOverrides(undefined);
      } else {
        throw new Error(`Failed to load theme tokens: ${response.status}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      clientLogger.warn('Theme: failed to load theme tokens', { themeId, error: message });
      // Fall back to default tokens
      setTokens(DEFAULT_THEME_TOKENS);
      setThemeFonts([]);
      setCssOverrides(undefined);
    }
  }, []);

  const loadAvailableThemes = useCallback(async () => {
    try {
      clientLogger.debug('Theme: loading available themes');

      const response = await fetch('/api/themes');
      if (response.ok) {
        const data = await response.json();
        // API returns { themes: [...], stats: {...} } - extract just the themes array
        // Filter out the default theme since it's handled separately in the UI
        const themes = (data.themes || []).filter((t: ThemeSummary) => !t.isDefault);
        setAvailableThemes(themes);

        clientLogger.debug('Theme: loaded available themes', {
          count: themes.length,
        });
      } else {
        throw new Error(`Failed to load themes: ${response.status}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      clientLogger.warn('Theme: failed to load available themes', { error: message });
      // Don't set error for this - themes list is non-critical
    }
  }, []);

  const loadPreference = useCallback(async () => {
    // Don't load if not authenticated
    if (status !== 'authenticated') {
      clientLogger.debug('Theme: skipping preference load (not authenticated)');
      setIsLoading(false);
      return;
    }

    try {
      clientLogger.debug('Theme: loading user preference');

      const response = await fetch('/api/theme-preference');
      if (response.ok) {
        const preference = await response.json();
        setActiveThemeId(preference.activeThemeId ?? null);
        setColorModeState(preference.colorMode ?? 'system');
        setShowNavThemeSelectorState(preference.showNavThemeSelector ?? false);

        clientLogger.debug('Theme: loaded user preference', {
          activeThemeId: preference.activeThemeId,
          colorMode: preference.colorMode,
          showNavThemeSelector: preference.showNavThemeSelector,
        });

        // If a theme is selected, load its tokens
        if (preference.activeThemeId) {
          await loadThemeTokens(preference.activeThemeId);
        }
      } else if (response.status === 401) {
        // Not authenticated, use defaults
        clientLogger.debug('Theme: not authenticated, using defaults');
      } else {
        throw new Error(`Failed to load preference: ${response.status}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      clientLogger.warn('Theme: failed to load preference', { error: message });
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

  const setTheme = useCallback(async (themeId: string | null) => {
    clientLogger.debug('Theme: setting theme', { themeId });

    // Update local state immediately for responsiveness
    setActiveThemeId(themeId);

    // Load new theme tokens and fonts
    if (themeId) {
      await loadThemeTokens(themeId);
    } else {
      setTokens(DEFAULT_THEME_TOKENS);
      setThemeFonts([]);
      setCssOverrides(undefined);
    }

    // Persist to server
    if (status === 'authenticated') {
      try {
        const response = await fetch('/api/theme-preference', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activeThemeId: themeId }),
        });

        if (!response.ok) {
          throw new Error(`Failed to save preference: ${response.status}`);
        }

        clientLogger.info('Theme: preference saved', { themeId });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        clientLogger.warn('Theme: failed to save preference', { error: message });
        // Don't revert local state - preference will be saved on next attempt
      }
    }
  }, [status, loadThemeTokens]);

  const setColorMode = useCallback(async (mode: ColorMode) => {
    clientLogger.debug('Theme: setting color mode', { mode });

    // Update local state immediately
    setColorModeState(mode);

    // Persist to server
    if (status === 'authenticated') {
      try {
        const response = await fetch('/api/theme-preference', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ colorMode: mode }),
        });

        if (!response.ok) {
          throw new Error(`Failed to save preference: ${response.status}`);
        }

        clientLogger.info('Theme: color mode preference saved', { mode });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        clientLogger.warn('Theme: failed to save color mode preference', { error: message });
      }
    }
  }, [status]);

  const refreshThemes = useCallback(async () => {
    await loadAvailableThemes();
  }, [loadAvailableThemes]);

  const setShowNavThemeSelector = useCallback(async (show: boolean) => {
    clientLogger.debug('Theme: setting showNavThemeSelector', { show });

    // Update local state immediately
    setShowNavThemeSelectorState(show);

    // Persist to server
    if (status === 'authenticated') {
      try {
        const response = await fetch('/api/theme-preference', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ showNavThemeSelector: show }),
        });

        if (!response.ok) {
          throw new Error(`Failed to save preference: ${response.status}`);
        }

        clientLogger.info('Theme: showNavThemeSelector preference saved', { show });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        clientLogger.warn('Theme: failed to save showNavThemeSelector preference', { error: message });
      }
    }
  }, [status]);

  // ============================================================================
  // CONTEXT VALUE
  // ============================================================================

  const value = useMemo<ThemeContextValue>(() => ({
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
  }), [
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
  ]);

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

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook to access theme context
 *
 * @throws Error if used outside ThemeProvider
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }

  return context;
}
