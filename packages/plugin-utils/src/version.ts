/**
 * Quilltap Version Management
 *
 * Provides access to the Quilltap application version for plugins.
 * Uses the same globalThis injection pattern as the logger factory,
 * allowing the host app to inject its version at startup.
 *
 * @module @quilltap/plugin-utils/version
 */

/**
 * Global key used to store the injected Quilltap version.
 * Must match the key used by the host app's injection code.
 */
const GLOBAL_VERSION_KEY = '__quilltap_app_version';

/**
 * Inject the Quilltap application version into the global namespace.
 *
 * This should be called early in plugin initialization (alongside the
 * logger factory injection), before any plugins are loaded. Plugins
 * can then retrieve the version via `getQuilltapVersion()`.
 *
 * @param version - The Quilltap application version string (e.g., '3.3.0')
 *
 * @example
 * ```typescript
 * import { __injectQuilltapVersion } from '@quilltap/plugin-utils';
 * import packageJson from './package.json';
 *
 * __injectQuilltapVersion(packageJson.version);
 * ```
 */
export function __injectQuilltapVersion(version: string): void {
  (globalThis as Record<string, unknown>)[GLOBAL_VERSION_KEY] = version;
}

/**
 * Clear the injected Quilltap version from the global namespace.
 *
 * Useful for testing or cleanup.
 */
export function __clearQuilltapVersion(): void {
  (globalThis as Record<string, unknown>)[GLOBAL_VERSION_KEY] = undefined;
}

/**
 * Get the Quilltap application version.
 *
 * Returns the version injected by the host app, or 'unknown' if
 * no version has been injected (e.g., running outside of Quilltap).
 *
 * @returns The Quilltap version string (e.g., '3.3.0') or 'unknown'
 */
export function getQuilltapVersion(): string {
  const version = (globalThis as Record<string, unknown>)[GLOBAL_VERSION_KEY];
  return typeof version === 'string' ? version : 'unknown';
}

/**
 * Get the Quilltap User-Agent string for API requests.
 *
 * Returns a string in the format `Quilltap/{version}` suitable for
 * use as a User-Agent header or app identifier in API calls.
 *
 * @returns User-Agent string (e.g., 'Quilltap/3.3.0')
 *
 * @example
 * ```typescript
 * import { getQuilltapUserAgent } from '@quilltap/plugin-utils';
 *
 * const client = new OpenAI({
 *   apiKey,
 *   defaultHeaders: { 'User-Agent': getQuilltapUserAgent() },
 * });
 * ```
 */
export function getQuilltapUserAgent(): string {
  return `Quilltap/${getQuilltapVersion()}`;
}
