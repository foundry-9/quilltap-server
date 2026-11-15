/**
 * Theme Provider Types
 *
 * TypeScript interfaces and types for the Quilltap theming system.
 */

import type { ColorMode, ThemePreference } from '@/lib/themes/types';
import type { RefusedTheme } from '@/lib/themes/refused';

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
  /** How this theme was loaded: a bundle, or the built-in default */
  source?: 'bundle' | 'default';
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

  /** List of available themes */
  availableThemes: ThemeSummary[];

  /** The default theme's own entry: its swatches and heading font come from the registry defaults (null until loaded) */
  defaultTheme: ThemeSummary | null;

  /** Themes found but not worn: made for an earlier Quilltap */
  refusedThemes: RefusedTheme[];

  /** Changes whenever the injected theme CSS changes (a cache key for theme-coloured renders) */
  themeRevision: number;

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

  /**
   * The theme being previewed in place of the worn one (the theme editor's
   * live preview), or null. `activeThemeId` and the stored preference are
   * untouched while it is set.
   */
  preview: { themeId: string } | null;

  /**
   * Show `value` in place of the worn theme, or (null) restore the worn theme
   * without a fetch. The only way a preview reaches the DOM: it goes through
   * the same `<style>` element and `<html>` attributes as the worn theme.
   */
  setPreview: (value: ThemePreview | null) => void;
}

/** A theme shown in place of the worn one: what the provider would load for it. */
export interface ThemePreview {
  themeId: string;
  /** Compiled CSS in injector order: font faces, tokens, icons, custom. */
  css: string;
  features: ThemeFeatureFlags;
  choices: Record<string, string>;
  subsystems: Record<string, SubsystemOverride> | null;
}

/**
 * Props for ThemeProvider component
 */
export interface ThemeProviderProps {
  children: React.ReactNode;
  /** Initial theme preference (for SSR hydration) */
  initialPreference?: ThemePreference;
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

/** App-owned behaviour a theme switches on. */
export interface ThemeFeatureFlags {
  pageBackground: boolean;
  focusRing: boolean;
  scrollbar: boolean;
}

/**
 * Response from the theme tokens API: the theme's CSS compiled and validated
 * server-side (font faces, tokens, icons, scoped custom CSS, in injection
 * order), its choices and the features it switches on. The default theme's
 * CSS is empty.
 */
export interface ThemeTokensResponse {
  css: string;
  choices: Record<string, string>;
  features: ThemeFeatureFlags;
  fonts?: ThemeFont[];
  icons?: ThemeIcon[];
  subsystems?: Record<string, SubsystemOverride>;
}

/**
 * Response from themes list API
 */
export interface ThemesListResponse {
  themes: ThemeSummary[];
  refused?: RefusedTheme[];
  stats?: Record<string, unknown>;
}
