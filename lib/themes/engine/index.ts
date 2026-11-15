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
export { rewriteUrls, mapUrlTargets, type UrlContext } from './urls';
export { resolveTheme, emitThemeCss, choicesInForce, type RegistryView, type ResolvedTheme, type ResolvedValue, type ValueSource } from './resolve';
export { scopeThemeCss, scopeSelector, type ScopeResult } from './scope';
export { themeScopePrelude, wrapInThemeScope } from './boundary';
export { validateThemeDocument, tailwindTokenNames, tailwindAlias, nearestName, type ValidationContext, type ThemeDocumentValidation } from './validate';
export { compileTheme, compiledThemeCss, defaultThemePreview, deriveThemeFeatures, type CompiledTheme, type CompiledThemeFeatures, type PreviewSwatch, type ThemePreview } from './compile';
export { resolveLiteral } from './literal';
export { checkContrast, contrastWarnings, type ContrastFinding, type ContrastMode } from './contrast';
export { typeProblem, CSS_WIDE_KEYWORDS, LENGTH_KEYWORDS, LENGTH_UNITS } from './type-check';
export * from './values';
export * from './primitives';
