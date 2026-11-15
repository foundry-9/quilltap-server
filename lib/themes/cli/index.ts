/**
 * The theme engine as the `quilltap themes` CLI uses it.
 *
 * `scripts/build-cli-theme-engine.mjs` bundles this entry — the engine, the
 * token registry, the hook catalogue, the icon names and the subsystem ids —
 * into one CommonJS file, `packages/quilltap/lib/theme-engine.generated.js`,
 * so the CLI validates a bundle exactly as the app does. The app's logger is
 * replaced by `./logger.ts` (silent) in that build; `yauzl` stays external,
 * being a CLI dependency already.
 *
 * @module themes/cli
 */

export {
  validateThemeBundle,
  validateThemeDirectory,
  extractThemeBundle,
  packThemeDirectory,
  MAX_BUNDLE_SIZE,
  type ValidationResult,
} from '../bundle-archive';
export { CURRENT_THEME_FORMAT_VERSION, earlierThemeMessage, refusalForManifest } from '../refused';
export { HOOK_CATALOGUE } from '../hooks';
export { THEME_MANIFEST_SCHEMA_URL, THEME_TOKENS_SCHEMA_URL } from '../schemas';
