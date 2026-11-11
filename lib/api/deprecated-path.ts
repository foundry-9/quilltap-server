/**
 * Old route paths that still answer for one release after their action moved
 * to `?action=` on a parent route (refactor 4.13, API inputs §4.6).
 *
 * A deprecated path runs the same handler as its replacement, logs a warning
 * once per process naming the replacement, and marks every response with
 * `Deprecation: true` and a `Link: <replacement>; rel="successor-version"`
 * header, so a client (or the CLI) can see the move without breaking. Every
 * alias goes through this wrapper, which makes them easy to find and remove:
 * grep for `deprecatedPath(`.
 *
 * @module api/deprecated-path
 */

import { logger } from '@/lib/logger';

/** When the aliases are due to go. */
export const DEPRECATED_PATHS_REMOVED_IN = '4.14';

const warned = new Set<string>();

/**
 * Wrap a route handler so it answers at an old path. `oldPath` and
 * `replacement` are documentation strings (`/api/v1/wardrobe/transfers`,
 * `/api/v1/wardrobe?action=move-to-tier`).
 */
export function deprecatedPath<A extends unknown[], R extends Response>(
  oldPath: string,
  replacement: string,
  handler: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args: A) => {
    if (!warned.has(oldPath)) {
      warned.add(oldPath);
      logger.warn('[API] Deprecated route path called; it will be removed', {
        oldPath,
        replacement,
        removedIn: DEPRECATED_PATHS_REMOVED_IN,
      });
    }
    const response = await handler(...args);
    try {
      response.headers.set('Deprecation', 'true');
      response.headers.set('Link', `<${replacement}>; rel="successor-version"`);
    } catch {
      // A response with immutable headers (rare) still answers; only the hint is lost.
    }
    return response;
  };
}
