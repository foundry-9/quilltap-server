/**
 * Theme engine — the browser-safe entry.
 *
 * What the theme editor's live preview needs, and nothing that pulls
 * PostCSS, `fs`, a `node:` module or the logger into the client bundle (a
 * test walks this module's import graph and holds it): the document types
 * and schemas, resolve and emit, the choices in force, the feature
 * derivation, the literal resolver the swatches read, the registry view and
 * the contrast check. Validation of a whole bundle and scoping of custom CSS
 * stay server-side (`./index.ts`).
 *
 * @module themes/engine/client
 */

import { THEME_CHOICES, THEME_TOKENS } from '../registry';
import type { RegistryView } from './resolve';

export * from './document';
export { resolveTheme, emitThemeCss, choicesInForce, type RegistryView, type ResolvedTheme, type ResolvedValue, type ValueSource } from './resolve';
export { deriveThemeFeatures, type CompiledThemeFeatures } from './compile';
export { resolveLiteral } from './literal';
export { checkContrast, contrastWarnings, type ContrastFinding, type ContrastMode } from './contrast';
export { CONTRAST_PAIRS, CONTRAST_THRESHOLDS, TOKEN_GROUPS, THEME_TOKENS, THEME_CHOICES, type ContrastPair, type ContrastKind, type TokenDef, type TokenGroupDef } from '../registry';
export { parseColor, contrastRatio, type Rgba } from '../color';

/** The registry the engine resolves against — the same view the server uses. */
export const CLIENT_REGISTRY_VIEW: RegistryView = { tokens: THEME_TOKENS, choices: THEME_CHOICES };
