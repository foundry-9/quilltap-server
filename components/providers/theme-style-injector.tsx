"use client";

/**
 * Theme Style Injector
 *
 * Injects theme CSS variables into the document via a style tag.
 * This component handles the runtime application of theme tokens
 * as CSS custom properties.
 *
 * The generated CSS includes:
 * - @font-face rules for custom theme fonts
 * - :root selector with light mode colors and shared tokens
 * - .dark selector with dark mode colors
 * - [data-icon] rules overriding individual icons
 *
 * @module providers/theme-style-injector
 */

import { useMemo } from 'react';
import { themeTokensToCSS, generateFontFacesCSS, generateIconOverridesCSS } from '@/lib/themes/utils';
import type { ThemeTokens } from '@/lib/themes/types';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Font definition for client-side CSS injection
 */
export interface ThemeFontInfo {
  family: string;
  src: string;
  weight?: string;
  style?: string;
  display?: 'auto' | 'block' | 'swap' | 'fallback' | 'optional';
}

/**
 * Icon override for client-side CSS injection
 */
export interface ThemeIconInfo {
  /** Canonical icon name (must match an app IconName to take effect) */
  name: string;
  /** Resolved asset URL (svg or webp) */
  src: string;
}

export interface ThemeStyleInjectorProps {
  /** Theme tokens to convert to CSS variables */
  tokens: ThemeTokens | null;

  /** Current color mode (used for logging/debugging) */
  mode: 'light' | 'dark';

  /** Optional CSS overrides from theme plugin (Tier 3 customization) */
  cssOverrides?: string;

  /** Optional theme ID for data attributes */
  themeId?: string | null;

  /** Custom fonts to load via @font-face rules */
  fonts?: ThemeFontInfo[];

  /** Per-icon overrides to apply via [data-icon] rules */
  icons?: ThemeIconInfo[];
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Injects theme CSS variables into the document
 *
 * Uses a <style> tag with a stable ID that can be replaced
 * when the theme changes. Memoizes CSS generation to avoid
 * unnecessary recalculations.
 *
 * @example
 * ```tsx
 * <ThemeStyleInjector
 *   tokens={currentTheme.tokens}
 *   mode={resolvedColorMode}
 *   cssOverrides={currentTheme.cssOverrides}
 *   themeId={currentTheme.id}
 * />
 * ```
 */
export function ThemeStyleInjector({
  tokens,
  mode,
  cssOverrides,
  themeId,
  fonts,
  icons,
}: ThemeStyleInjectorProps) {
  // Generate @font-face CSS for custom fonts
  const fontFacesCss = useMemo(() => {
    if (!fonts || fonts.length === 0) {
      return '';
    }
    return generateFontFacesCSS(fonts);
  }, [fonts]);

  // Generate [data-icon] override CSS for custom icons
  const iconOverridesCss = useMemo(() => {
    if (!icons || icons.length === 0) {
      return '';
    }
    return generateIconOverridesCSS(icons);
  }, [icons]);

  // Generate CSS from tokens (no logging in useMemo to avoid render-time side effects)
  const baseCss = useMemo(() => {
    if (!tokens) {
      return null;
    }
    return themeTokensToCSS(tokens);
  }, [tokens]);

  // Combine all CSS: fonts + variables + icon overrides + component overrides
  const fullCss = useMemo(() => {
    if (!baseCss) return null;

    const parts: string[] = [];

    // Add @font-face rules first
    if (fontFacesCss) {
      parts.push(`/* Theme Custom Fonts */\n${fontFacesCss}`);
    }

    // Add theme variables
    parts.push(baseCss);

    // Add per-icon overrides (unlayered, so they beat the @layer defaults in _icons.css)
    if (iconOverridesCss) {
      parts.push(`/* Theme Icon Overrides */\n${iconOverridesCss}`);
    }

    // Add component overrides
    if (cssOverrides) {
      parts.push(`/* Theme Component Overrides */\n${cssOverrides}`);
    }

    return parts.join('\n\n');
  }, [baseCss, cssOverrides, fontFacesCss, iconOverridesCss]);

  // Don't render anything if no CSS to inject
  if (!fullCss) {
    return null;
  }

  return (
    <style
      id="quilltap-theme-variables"
      data-theme-id={themeId ?? 'default'}
      data-color-mode={mode}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: fullCss }}
    />
  );
}
