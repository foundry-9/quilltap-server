"use client";

/**
 * Theme Style Injector
 *
 * Injects the active theme's CSS into the document via a style tag. The CSS
 * is compiled and validated server-side (font faces, tokens, icon overrides,
 * scoped custom CSS, in that order); the default theme has none, and then
 * nothing is injected — the app's own stylesheet is the default.
 *
 * @module providers/theme-style-injector
 */

export interface ThemeStyleInjectorProps {
  /** Current color mode (exposed as a data attribute for debugging) */
  mode: 'light' | 'dark';

  /** Optional theme ID for data attributes */
  themeId?: string | null;

  /** The active theme's compiled CSS; null or empty injects nothing. */
  compiledCss?: string | null;
}

/**
 * Injects theme CSS into the document
 *
 * Uses a <style> tag with a stable ID that is replaced when the theme changes.
 */
export function ThemeStyleInjector({ mode, themeId, compiledCss }: ThemeStyleInjectorProps) {
  if (!compiledCss) {
    return null;
  }

  return (
    <style
      id="quilltap-theme-variables"
      data-theme-id={themeId ?? 'default'}
      data-color-mode={mode}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: compiledCss }}
    />
  );
}
