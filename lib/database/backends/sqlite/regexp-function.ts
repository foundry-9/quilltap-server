/**
 * The `regexp()` SQL function — JavaScript regular expressions, visible from SQL.
 *
 * SQLite parses `X REGEXP Y` but ships no implementation: the operator calls a
 * user function named `regexp(Y, X)` and fails with "no such function: REGEXP"
 * when none is registered. This module supplies one, backed by the JavaScript
 * `RegExp` engine, so the operator works and so does the call form with an
 * optional third argument of flags:
 *
 * ```sql
 * SELECT * FROM log_entries WHERE "message" REGEXP 'lock(pick|smith)';
 * SELECT * FROM log_entries WHERE regexp('^the vault', "message", 'i');
 * ```
 *
 * Compiled patterns are cached per (pattern, flags), so a scan compiles once
 * rather than once per row. A pattern that does not compile throws, which
 * SQLite surfaces as the statement's error — callers that take a pattern from
 * a model should compile it first ({@link compileSqlRegexp}) and answer the
 * mistake in plain words.
 *
 * Registered on the LLM logs connection (`llm-logs-client.ts`), where the
 * `log_entries` table that `log_grep` searches lives.
 *
 * @module lib/database/backends/sqlite/regexp-function
 */

import type { Database as DatabaseType } from 'better-sqlite3';

/** The SQL-visible name. SQLite's `REGEXP` operator resolves to it. */
export const REGEXP_FUNCTION_NAME = 'regexp';

/** Flags a caller may pass. `g` and `y` are stateful and meaningless for a match test. */
const ALLOWED_FLAGS = /^[imsu]*$/;

/** Bound on the compiled-pattern cache; a scan uses one entry, so this is generous. */
const CACHE_LIMIT = 64;

const cache = new Map<string, RegExp>();

/**
 * Compile a pattern the way the SQL function will. Returns the RegExp, or the
 * reason it would not compile — the one statement of what the function accepts.
 */
export function compileSqlRegexp(
  pattern: string,
  flags = '',
): { ok: true; regexp: RegExp } | { ok: false; reason: string } {
  if (!ALLOWED_FLAGS.test(flags)) {
    return { ok: false, reason: `unsupported flags "${flags}" — use any of i, m, s, u` };
  }
  const key = `${flags}/${pattern}`;
  const cached = cache.get(key);
  if (cached) return { ok: true, regexp: cached };
  try {
    const regexp = new RegExp(pattern, flags);
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(key, regexp);
    return { ok: true, regexp };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Register `regexp(pattern, value[, flags])` on a connection. NULL in either
 * of the first two arguments answers NULL (no match), as SQL comparisons do.
 *
 * Idempotent in practice: better-sqlite3 replaces an existing definition.
 */
export function registerRegexpFunction(db: DatabaseType): void {
  db.function(REGEXP_FUNCTION_NAME, { deterministic: true, varargs: true }, (...args: unknown[]) => {
    const [pattern, value, flags] = args;
    if (pattern === null || pattern === undefined || value === null || value === undefined) return null;
    const compiled = compileSqlRegexp(String(pattern), flags === null || flags === undefined ? '' : String(flags));
    if (!compiled.ok) throw new Error(`Invalid regular expression: ${compiled.reason}`);
    return compiled.regexp.test(String(value)) ? 1 : 0;
  });
}
