/**
 * User-Agent Utilities
 *
 * Provides scrubbing of User-Agent strings to remove Electron and Quilltap
 * identifiers, so that HTTP requests made by tools (e.g., curl) appear to
 * come from a normal browser.
 *
 * @module utils/user-agent
 */

/**
 * Scrub Electron and Quilltap tokens from a User-Agent string.
 *
 * Electron User-Agents look like:
 *   Mozilla/5.0 (...) AppleWebKit/537.36 (KHTML, like Gecko) Quilltap/3.3.0 Chrome/128.0.0.0 Electron/32.0.0 Safari/537.36
 *
 * After scrubbing:
 *   Mozilla/5.0 (...) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36
 *
 * Regular browser User-Agents pass through unchanged.
 * Returns undefined if the input is undefined (no User-Agent header).
 *
 * @param userAgent - Raw User-Agent string from the request
 * @returns Scrubbed User-Agent string, or undefined if input was undefined
 */
export function scrubUserAgent(userAgent: string | undefined): string | undefined {
  if (!userAgent) return undefined;

  return userAgent
    .replace(/\s*Quilltap\/\S+/g, '')
    .replace(/\s*Electron\/\S+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
