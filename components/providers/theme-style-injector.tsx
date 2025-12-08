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
 *
 * @module providers/theme-style-injector
 */

import { useMemo, useEffect } from 'react';
import { themeTokensToCSS, generateFontFacesCSS } from '@/lib/themes/utils';
import { clientLogger } from '@/lib/client-logger';
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
}: ThemeStyleInjectorProps) {
  // Generate @font-face CSS for custom fonts
  const fontFacesCss = useMemo(() => {
    if (!fonts || fonts.length === 0) {
      return '';
    }
    return generateFontFacesCSS(fonts);
  }, [fonts]);

  // Generate CSS from tokens (no logging in useMemo to avoid render-time side effects)
  const baseCss = useMemo(() => {
    if (!tokens) {
      return null;
    }
    return themeTokensToCSS(tokens);
  }, [tokens, mode, themeId]);

  // Combine all CSS: fonts + variables + overrides
  const fullCss = useMemo(() => {
    if (!baseCss) return null;

    const parts: string[] = [];

    // Add @font-face rules first
    if (fontFacesCss) {
      parts.push(`/* Theme Custom Fonts */\n${fontFacesCss}`);
    }

    // Add theme variables
    parts.push(baseCss);

    // Add component overrides
    if (cssOverrides) {
      parts.push(`/* Theme Component Overrides */\n${cssOverrides}`);
    }

    return parts.join('\n\n');
  }, [baseCss, cssOverrides, fontFacesCss]);

  // Log CSS generation in effect (not during render to avoid setState during render)
  useEffect(() => {
    if (!tokens) {
      clientLogger.debug('ThemeStyleInjector: no tokens provided, skipping CSS generation');
      return;
    }

    clientLogger.debug('ThemeStyleInjector: CSS variables injected', {
      mode,
      themeId,
      hasTypography: !!tokens.typography,
      hasSpacing: !!tokens.spacing,
      hasEffects: !!tokens.effects,
      hasCssOverrides: !!cssOverrides,
      fontCount: fonts?.length || 0,
    });
  }, [tokens, mode, themeId, cssOverrides, fonts]);

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

// ============================================================================
// UTILITY: SERVER-SIDE CSS GENERATION
// ============================================================================

/**
 * Generate theme CSS string for server-side rendering
 *
 * This function can be used in layout.tsx or other server components
 * to generate initial CSS that prevents flash of unstyled content.
 *
 * @param tokens - Theme tokens
 * @param themeId - Optional theme ID for comments
 * @returns CSS string ready to be injected
 *
 * @example
 * ```tsx
 * // In layout.tsx
 * const initialCss = generateThemeCSS(DEFAULT_THEME_TOKENS, 'default');
 * return (
 *   <html>
 *     <head>
 *       <style dangerouslySetInnerHTML={{ __html: initialCss }} />
 *     </head>
 *     ...
 *   </html>
 * );
 * ```
 */
export function generateThemeCSS(tokens: ThemeTokens, themeId?: string): string {
  const css = themeTokensToCSS(tokens);

  return `/* Quilltap Theme: ${themeId ?? 'default'} */\n${css}`;
}
