/**
 * Table Shape Check
 *
 * Does a table on disk still have the shape its Zod schema says it has? The
 * generated DDL is `CREATE TABLE IF NOT EXISTS`, so running it against a
 * damaged table proves nothing: a table swapped for a view, or a column
 * renamed in place, passes untouched unless an index happens to name the
 * missing column. This is the check that does not depend on that luck.
 *
 * Extra columns are fine (subclasses add them in `onTableEnsured`); a missing
 * schema column, or a name that is not a table at all, is damage.
 *
 * Used by the boot-time structural pass (`lib/startup/verify-structural-tables.ts`,
 * bug 176) through each repository's `verifyStructure()`.
 */

import { z } from 'zod';
import { extractSchemaMetadata } from './schema-translator';

/**
 * Run one read-only statement and return its rows. Lets the check serve both
 * a raw dedicated-database handle and the main backend's `rawQuery`.
 */
export type ShapeQuery = <R>(sql: string, params: unknown[]) => R[] | Promise<R[]>;

/**
 * Describe what is wrong with `name`'s shape, or return null when it matches
 * the schema.
 */
export async function findTableShapeProblem(
  query: ShapeQuery,
  name: string,
  schema: z.ZodType,
): Promise<string | null> {
  const objects = await query<{ type: string }>(
    `SELECT type FROM sqlite_master WHERE name = ? AND type IN ('table', 'view')`,
    [name],
  );
  if (objects.length === 0) {
    return `table ${name} does not exist`;
  }
  if (objects[0].type !== 'table') {
    return `${name} is a ${objects[0].type}, not a table`;
  }

  const columns = await query<{ name: string }>(`PRAGMA table_info("${name}")`, []);
  const present = new Set(columns.map(c => c.name));
  const missing = extractSchemaMetadata(name, schema)
    .fields.map(f => f.name)
    .filter(column => !present.has(column));

  if (missing.length > 0) {
    return `table ${name} is missing column${missing.length === 1 ? '' : 's'} ${missing.join(', ')}`;
  }
  return null;
}
