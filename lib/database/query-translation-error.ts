/**
 * The error the query translator throws for a filter or sort it cannot
 * translate correctly (a sort on a field that is not a column, a `$regex`
 * carrying an escaped string, an unknown operator).
 *
 * It is a programming error, never "no rows": `safeQuery` rethrows it even
 * in fallback mode, so a repository's `[]` / `null` fallback can never hide a
 * filter the database was never asked (refactor 4.13 §5.1, #192).
 *
 * Kept in its own module so `safe-query.ts` can recognise it without pulling
 * in the SQLite translator.
 *
 * @module database/query-translation-error
 */

export class QueryTranslationError extends Error {
  readonly code = 'QUERY_TRANSLATION_ERROR' as const;

  constructor(message: string) {
    super(message);
    this.name = 'QueryTranslationError';
  }
}

/** Recognise a translator error by code, so it survives a module duplicate. */
export function isQueryTranslationError(error: unknown): error is QueryTranslationError {
  return (
    error instanceof QueryTranslationError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === 'QUERY_TRANSLATION_ERROR')
  );
}
