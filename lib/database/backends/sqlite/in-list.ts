/**
 * The right-hand side of an SQL `IN` list, safe at any length (#205).
 *
 * SQLite caps a statement at 32,766 bound variables. One `?` per id meant an
 * `$in` over a long chat's message ids, or a large memory corpus, threw
 * `too many SQL variables` — which a repository's `safeQuery` fallback then
 * turned into "no rows", so the caller carried on as if nothing matched.
 *
 * A short list keeps its ordinary placeholders (the planner sees each value).
 * A long one is bound as ONE parameter, a JSON array, and unpacked with
 * `json_each` — still an `IN (subquery)` SQLite answers from an index on the
 * left-hand column, and one variable however many values it carries. Values
 * that do not survive a JSON round trip unchanged (anything but strings and
 * finite numbers) keep the placeholder form.
 *
 * @module database/backends/sqlite/in-list
 */

/** Above this many values a list is bound as one JSON parameter. */
export const INLINE_IN_LIST_LIMIT = 500;

export interface InList {
  /** Parenthesised right-hand side: `(?, ?, …)` or `(SELECT value FROM json_each(?))`. */
  sql: string;
  params: unknown[];
}

function jsonSafe(value: unknown): boolean {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

/**
 * Build the right-hand side of `<expr> IN …` / `<expr> NOT IN …` for `values`.
 * Callers handle the empty list themselves (`IN ()` is not valid SQL).
 */
export function sqlInList(values: readonly unknown[]): InList {
  if (values.length > INLINE_IN_LIST_LIMIT && values.every(jsonSafe)) {
    return { sql: '(SELECT value FROM json_each(?))', params: [JSON.stringify(values)] };
  }
  return { sql: `(${values.map(() => '?').join(', ')})`, params: [...values] };
}
