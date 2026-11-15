/**
 * Theme engine — the theme document.
 *
 * Pure functions: validate, resolve, emit, scope, compile. No React and no
 * file access — the bundle loader reads files and passes strings and the
 * bundle's file list in. Server-side (scoping uses PostCSS).
 *
 * @module themes/engine
 */

export * from './document';
export { cssString, isSafeBundlePath, bundleAssetUrl, bundleFontUrl } from './css-text';
export { rewriteUrls, type UrlContext } from './urls';
export { resolveTheme, emitThemeCss, choicesInForce, type RegistryView, type ResolvedTheme, type ResolvedValue, type ValueSource } from './resolve';
export { scopeThemeCss, scopeSelector, type ScopeResult } from './scope';
export { validateThemeDocument, tailwindTokenNames, tailwindAlias, nearestName, type ValidationContext, type ThemeDocumentValidation } from './validate';
export { compileTheme, compiledThemeCss, defaultThemePreview, type CompiledTheme, type CompiledThemeFeatures, type PreviewSwatch, type ThemePreview } from './compile';
