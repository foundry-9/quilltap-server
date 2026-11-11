/**
 * Safe Query Helper
 *
 * Eliminates redundant try-catch boilerplate across repository methods.
 * Provides consistent error logging with automatic error message extraction.
 *
 * Three failure modes:
 * - Rethrow (no fallback): logs error then re-throws
 * - Fallback (fallback provided): logs error then returns fallback value
 * - Silent (fallback = undefined): logs error then returns undefined
 *
 * Fallback and silent mode are suspended inside
 * `withStrictRepositoryFailures` — see `./strict-failures` for why the import
 * path cannot afford them — and never apply to a `QueryTranslationError`: a
 * filter the translator refused is a programming error, and returning the
 * fallback would make it look like "no rows" (refactor 4.13 §5.1).
 */

import { logger } from '@/lib/logger';
import { strictRepositoryFailuresActive } from './strict-failures';
import { isQueryTranslationError } from '../query-translation-error';

/**
 * Extract a human-readable error message from an unknown error value.
 */
export function extractErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Execute an async operation with standardized error handling.
 *
 * @overload Rethrow mode — no fallback argument; logs then re-throws.
 */
export async function safeQuery<R>(
  operation: () => Promise<R>,
  errorMessage: string,
  context?: Record<string, unknown>
): Promise<R>;

/**
 * @overload Fallback mode — returns `fallback` on error instead of throwing.
 */
export async function safeQuery<R>(
  operation: () => Promise<R>,
  errorMessage: string,
  context: Record<string, unknown>,
  fallback: R
): Promise<R>;

/**
 * Implementation — uses rest param length to distinguish rethrow vs fallback.
 */
export async function safeQuery<R>(
  operation: () => Promise<R>,
  errorMessage: string,
  context: Record<string, unknown> = {},
  ...rest: [] | [R]
): Promise<R> {
  try {
    return await operation();
  } catch (error) {
    // A caller that asked for a fallback still gets one — unless we are inside
    // a scope that has declared it would rather see the failure than a value
    // indistinguishable from "there was nothing there" (Bug 79).
    const strict = strictRepositoryFailuresActive();
    const untranslatable = isQueryTranslationError(error);
    logger.error(errorMessage, {
      ...context,
      error: extractErrorMessage(error),
      ...(strict ? { strictFailures: true } : {}),
      ...(untranslatable ? { untranslatableQuery: true } : {}),
    });
    if (rest.length > 0 && !strict && !untranslatable) return rest[0] as R;
    throw error;
  }
}
