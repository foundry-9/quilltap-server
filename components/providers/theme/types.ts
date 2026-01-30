/**
 * Theme Provider Types
 *
 * TypeScript interfaces and types for the Quilltap theming system.
 */

import type { ThemeTokens, ColorMode, ThemePreference } from '@/lib/themes/types';

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
  /** Heading font for theme preview in selector */
  headingFont?: {
    /** CSS font-family value */
    family: string;
    /** URL to load the font (for custom fonts) */
    url?: string;
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

/**
 * Props for ThemeProvider component
 */
export interface ThemeProviderProps {
  children: React.ReactNode;
  /** Initial theme preference (for SSR hydration) */
  initialPreference?: ThemePreference;
  /** Initial tokens (for SSR hydration) */
  initialTokens?: ThemeTokens;
  /** Initial CSS overrides (for SSR hydration) */
  initialCssOverrides?: string;
}

/**
 * Font configuration from theme
 */
export interface ThemeFont {
  family: string;
  src: string;
  weight?: string;
  style?: string;
  display?: 'auto' | 'block' | 'swap' | 'fallback' | 'optional';
}

/**
 * Response from theme tokens API
 */
export interface ThemeTokensResponse {
  tokens: ThemeTokens;
  fonts?: ThemeFont[];
  cssOverrides?: string;
}

/**
 * Response from themes list API
 */
export interface ThemesListResponse {
  themes: ThemeSummary[];
  stats?: Record<string, unknown>;
}
