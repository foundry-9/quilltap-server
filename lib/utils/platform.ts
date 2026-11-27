/**
 * Client platform detection for keyboard shortcuts.
 *
 * @module utils/platform
 */

/**
 * Whether the browser reports a macOS platform — the one question the
 * keyboard shortcuts ask (Cmd on a Mac, Ctrl elsewhere). False where there is
 * no `navigator` (server rendering).
 */
export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0
}
