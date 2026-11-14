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
  /** How this theme was loaded: 'plugin', 'bundle', or 'default' */
  source?: 'plugin' | 'bundle' | 'default';
  /** Whether this theme's format is deprecated (plugin themes) */
  deprecated?: boolean;
  /** Theme document format (2: compiled server-side, see ThemeTokensResponseV2) */
  formatVersion?: 1 | 2;
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

  /** Subsystem display overrides from the active theme (null = no overrides) */
  subsystems: Record<string, SubsystemOverride> | null;

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
 * Subsystem display override from active theme
 */
export interface SubsystemOverride {
  name?: string;
  description?: string;
  thumbnail?: string;
  backgroundImage?: string;
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
 * Per-icon override from theme (resolved asset URL)
 */
export interface ThemeIcon {
  /** Canonical icon name (must match an app IconName to take effect) */
  name: string;
  /** Resolved asset URL (svg or webp) */
  src: string;
}

/**
 * Response from theme tokens API
 */
/** A version 1 theme: tokens plus raw CSS overrides, turned into CSS in the browser. */
export interface ThemeTokensResponseV1 {
  formatVersion?: 1;
  tokens: ThemeTokens;
  fonts?: ThemeFont[];
  icons?: ThemeIcon[];
  cssOverrides?: string;
  subsystems?: Record<string, SubsystemOverride>;
}

/** App-owned behaviour a version 2 theme switches on. */
export interface ThemeFeatureFlags {
  pageBackground: boolean;
  focusRing: boolean;
  scrollbar: boolean;
}

/**
 * A version 2 theme: its CSS compiled and validated server-side (font faces,
 * tokens, icons, scoped custom CSS, in injection order), its choices and the
 * features it switches on. There is no version 1 token shape.
 */
export interface ThemeTokensResponseV2 {
  formatVersion: 2;
  css: string;
  choices: Record<string, string>;
  features: ThemeFeatureFlags;
  fonts?: ThemeFont[];
  icons?: ThemeIcon[];
  subsystems?: Record<string, SubsystemOverride>;
}

export type ThemeTokensResponse = ThemeTokensResponseV1 | ThemeTokensResponseV2;

/**
 * Response from themes list API
 */
export interface ThemesListResponse {
  themes: ThemeSummary[];
  stats?: Record<string, unknown>;
}
