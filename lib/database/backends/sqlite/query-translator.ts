/**
 * SQLite Query Translator
 *
 * Translates the abstract query filter format to SQLite SQL statements.
 * Handles nested fields, JSON columns, and MongoDB-style operators.
 */

import { QueryFilter, QueryOptions, SortSpec, UpdateSpec, UpdateOperators } from '../../interfaces';
import { jsonExtract, jsonArrayContains, jsonArrayContainsAny, jsonArrayContainsLike, jsonArrayObjectMatch, jsonArrayObjectMatchAny, toJson, embeddingToBlob } from './json-columns';
import { textToBlob } from '@/lib/database/text-compression';
import { escapeLikeLiteral } from '@/lib/database/repositories/like-escape';
import { QueryTranslationError } from '@/lib/database/query-translation-error';
import { sqlInList } from './in-list';
import { logger } from '@/lib/logger';

// ============================================================================
// Types
// ============================================================================

export interface TranslatedQuery {
  sql: string;
  params: unknown[];
}

export interface TranslatedUpdate {
  setClauses: string[];
  params: unknown[];
}

// ============================================================================
// Filter Translation
// ============================================================================

/**
 * Convert a value for use as a SQLite parameter
 * Handles boolean conversion (true/false -> 1/0)
 */
function toSqliteParam(value: unknown): unknown {
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  return value;
}

function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

/**
 * The one spelling of a null test. SQL NULL compares UNKNOWN to everything,
 * so `= ?` / `!= ?` bound to NULL match no row at all (#196): a comparison
 * against null must be written `IS NULL` / `IS NOT NULL`, never bound.
 */
function nullTest(columnExpr: string, isNull: boolean): string {
  return `${columnExpr} ${isNull ? 'IS NULL' : 'IS NOT NULL'}`;
}

/**
 * A literal-text operand for `$contains` / `$startsWith`. Anything but a
 * string is refused: these exist for user text, and coercing an object to
 * `[object Object]` would search for that instead.
 */
function literalOperand(op: string, field: string, value: unknown): string {
  if (typeof value !== 'string') {
    throw new QueryTranslationError(`${op} on "${field}" needs a string, got ${value === null ? 'null' : typeof value}`);
  }
  return value;
}

/**
 * Translate a hand-written `$regex` to a `%…%` LIKE pattern: `.*` → `%`,
 * `.` → `_`. That is all it can express, so a pattern carrying a backslash —
 * which is always an escaped user string (`Mr\. Darcy`) — is refused: LIKE
 * would match the backslashes literally and find nothing (#192). User text
 * goes through `$contains`.
 */
function regexToLikePattern(field: string, value: unknown): string {
  const source = value instanceof RegExp ? value.source : String(value);
  if (source.includes('\\')) {
    throw new QueryTranslationError(
      `$regex on "${field}" carries an escaped pattern, which cannot be translated to LIKE; ` +
        `use $contains for literal text`
    );
  }
  return `%${source.replace(/\.\*/g, '%').replace(/\./g, '_')}%`;
}

/**
 * Check if a value is a comparison condition object
 */
function isComparisonCondition(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const keys = Object.keys(value);
  return keys.some(k => k.startsWith('$'));
}

/**
 * Translate a single field filter to SQL
 */
function translateFieldFilter(
  field: string,
  value: unknown,
  jsonColumns: Set<string>,
  arrayColumns: Set<string> = new Set()
): TranslatedQuery {
  const clauses: string[] = [];
  const params: unknown[] = [];

  // Handle dot notation for nested fields
  const parts = field.split('.');
  const isNestedInJson = parts.length > 1 && jsonColumns.has(parts[0]);
  const isNestedInArray = parts.length > 1 && arrayColumns.has(parts[0]);

  // Special handling for querying nested fields within array columns
  // e.g., participants.characterId where participants is an array of objects
  if (isNestedInArray) {
    const column = parts[0];
    const nestedPath = parts.slice(1).join('.');

    // Handle array object queries
    if (value === null || value === undefined) {
      // Check if any element has null/undefined for this field
      // This is complex - for now, treat as "no match" for null queries on array elements
      return { sql: '0', params: [] };
    } else if (isComparisonCondition(value)) {
      // Handle comparison operators for array object queries
      const conditions = value as Record<string, unknown>;

      for (const [op, opValue] of Object.entries(conditions)) {
        switch (op) {
          case '$eq': {
            const { sql, params: p } = jsonArrayObjectMatch(column, nestedPath, opValue);
            clauses.push(sql);
            params.push(...p);
            break;
          }
          case '$in': {
            if (Array.isArray(opValue) && opValue.length > 0) {
              const { sql, params: p } = jsonArrayObjectMatchAny(column, nestedPath, opValue);
              clauses.push(sql);
              params.push(...p);
            } else {
              clauses.push('0');
            }
            break;
          }
          case '$ne': {
            // NOT EXISTS for not equal
            const { sql, params: p } = jsonArrayObjectMatch(column, nestedPath, opValue);
            clauses.push(`NOT ${sql}`);
            params.push(...p);
            break;
          }
          default:
            throw new QueryTranslationError(`Unsupported operator ${op} for array-object field "${field}"`);
        }
      }
    } else {
      // Simple equality - e.g., participants.characterId = 'some-id'
      const { sql, params: p } = jsonArrayObjectMatch(column, nestedPath, value);
      clauses.push(sql);
      params.push(...p);
    }

    return {
      sql: clauses.length > 0 ? clauses.join(' AND ') : '1',
      params,
    };
  }

  // Determine the column name and JSON path for non-array JSON columns
  let columnExpr: string;
  if (isNestedInJson) {
    const column = parts[0];
    const jsonPath = '$.' + parts.slice(1).join('.');
    columnExpr = jsonExtract(column, jsonPath);
  } else {
    columnExpr = `"${field}"`;
  }

  // Handle different value types
  if (isNullish(value)) {
    clauses.push(nullTest(columnExpr, true));
  } else if (isComparisonCondition(value)) {
    // Handle comparison operators
    const conditions = value as Record<string, unknown>;

    for (const [op, opValue] of Object.entries(conditions)) {
      switch (op) {
        case '$eq':
          if (isNullish(opValue)) {
            clauses.push(nullTest(columnExpr, true));
          } else {
            clauses.push(`${columnExpr} = ?`);
            params.push(toSqliteParam(opValue));
          }
          break;

        case '$ieq':
          // Case-insensitive equals via SQLite's NOCASE collation. ASCII-only
          // case folding — sufficient for filesystem paths and identifiers,
          // not for arbitrary Unicode text.
          if (isNullish(opValue)) {
            clauses.push(nullTest(columnExpr, true));
          } else {
            clauses.push(`${columnExpr} = ? COLLATE NOCASE`);
            params.push(toSqliteParam(opValue));
          }
          break;

        case '$ne':
          if (isNullish(opValue)) {
            clauses.push(nullTest(columnExpr, false));
          } else {
            // `IS NOT` rather than `!=`: a NULL column is not equal to the
            // value, so it matches — `!=` would compare UNKNOWN and drop it.
            clauses.push(`${columnExpr} IS NOT ?`);
            params.push(toSqliteParam(opValue));
          }
          break;

        case '$gt':
          clauses.push(`${columnExpr} > ?`);
          params.push(toSqliteParam(opValue));
          break;

        case '$gte':
          clauses.push(`${columnExpr} >= ?`);
          params.push(toSqliteParam(opValue));
          break;

        case '$lt':
          clauses.push(`${columnExpr} < ?`);
          params.push(toSqliteParam(opValue));
          break;

        case '$lte':
          clauses.push(`${columnExpr} <= ?`);
          params.push(toSqliteParam(opValue));
          break;

        case '$in':
          if (Array.isArray(opValue) && opValue.length > 0) {
            // Check if we're querying an array column
            if (jsonColumns.has(field)) {
              // Search within JSON array
              const { sql, params: p } = jsonArrayContainsAny(field, opValue);
              clauses.push(sql);
              params.push(...p);
            } else {
              // Standard IN query - convert booleans in array. A null in the
              // list is matched with IS NULL; bound into IN (…) it never matches.
              const values = opValue.filter(v => !isNullish(v));
              const parts: string[] = [];
              if (values.length > 0) {
                const list = sqlInList(values.map(toSqliteParam));
                parts.push(`${columnExpr} IN ${list.sql}`);
                params.push(...list.params);
              }
              if (values.length < opValue.length) {
                parts.push(nullTest(columnExpr, true));
              }
              clauses.push(parts.length > 1 ? `(${parts.join(' OR ')})` : parts[0]);
            }
          } else {
            // Empty $in always false
            clauses.push('0');
          }
          break;

        case '$nin':
          if (Array.isArray(opValue) && opValue.length > 0) {
            // A NULL column is "not in" a list of values, so it matches unless
            // the list names null. Bound NULLs are kept out of NOT IN (…): one
            // there makes the test UNKNOWN for every row.
            const values = opValue.filter(v => !isNullish(v));
            const excludesNull = values.length < opValue.length;
            if (values.length === 0) {
              clauses.push(nullTest(columnExpr, false));
            } else {
              const list = sqlInList(values.map(toSqliteParam));
              const notIn = `${columnExpr} NOT IN ${list.sql}`;
              // NOT IN is already UNKNOWN (dropped) for a NULL column.
              clauses.push(excludesNull ? notIn : `(${nullTest(columnExpr, true)} OR ${notIn})`);
              params.push(...list.params);
            }
          }
          // Empty $nin is always true, no clause needed
          break;

        case '$exists':
          clauses.push(nullTest(columnExpr, !opValue));
          break;

        case '$like': {
          // Literal SQL LIKE pattern. Caller supplies `%` / `_` wildcards; the
          // translator does not wrap or transform the value. Unlike `$regex`,
          // this is safe for prefix/anchored matches (regex→LIKE conversion
          // cannot represent anchors because the regex path always wraps the
          // pattern in `%…%`).
          clauses.push(`${columnExpr} LIKE ?`);
          params.push(String(opValue));
          break;
        }

        case '$regex': {
          // Hand-written patterns only; see regexToLikePattern.
          const pattern = regexToLikePattern(field, opValue);
          if (jsonColumns.has(field)) {
            const { sql, params: p } = jsonArrayContainsLike(field, pattern);
            clauses.push(sql);
            params.push(...p);
          } else {
            clauses.push(`${columnExpr} LIKE ?`);
            params.push(pattern);
          }
          break;
        }

        case '$contains':
        case '$startsWith': {
          // Literal text: `%` and `_` (and the escape character) in the value
          // are escaped and the SQL declares ESCAPE '\', so the user's
          // characters match themselves. LIKE folds ASCII case.
          const literal = escapeLikeLiteral(literalOperand(op, field, opValue));
          const pattern = op === '$contains' ? `%${literal}%` : `${literal}%`;
          if (jsonColumns.has(field)) {
            const { sql, params: p } = jsonArrayContainsLike(field, pattern, { escaped: true });
            clauses.push(sql);
            params.push(...p);
          } else {
            clauses.push(`${columnExpr} LIKE ? ESCAPE '\\'`);
            params.push(pattern);
          }
          break;
        }

        default:
          throw new QueryTranslationError(`Unknown query operator ${op} on "${field}"`);
      }
    }
  } else if (Array.isArray(value)) {
    // Array equality - check if JSON array contains all values
    // This is a special case for tags: ['tag1', 'tag2']
    for (const item of value) {
      const { sql, params: p } = jsonArrayContains(field, item);
      clauses.push(sql);
      params.push(...p);
    }
  } else {
    // Simple equality - convert booleans to 0/1 for SQLite
    clauses.push(`${columnExpr} = ?`);
    params.push(toSqliteParam(value));
  }

  return {
    sql: clauses.length > 0 ? clauses.join(' AND ') : '1',
    params,
  };
}

/**
 * Parse a field reference from $expr format
 * e.g., '$attempts' -> 'attempts', 'literal' -> null
 */
function parseFieldRef(value: unknown): string | null {
  if (typeof value === 'string' && value.startsWith('$')) {
    return value.slice(1);
  }
  return null;
}

/**
 * Translate a MongoDB-style $expr to SQL
 * Supports basic field-to-field comparisons like { $lt: ['$attempts', '$maxAttempts'] }
 */
function translateExpr(expr: Record<string, unknown>): string | null {
  for (const [op, value] of Object.entries(expr)) {
    if (!Array.isArray(value) || value.length !== 2) {
      throw new QueryTranslationError(`Unsupported $expr format for ${op}`);
    }

    const [left, right] = value;
    const leftField = parseFieldRef(left);
    const rightField = parseFieldRef(right);

    // Both operands must be field references for field-to-field comparison
    if (!leftField || !rightField) {
      throw new QueryTranslationError(`$expr ${op} requires two field references (e.g. $fieldName)`);
    }

    switch (op) {
      case '$lt':
        return `"${leftField}" < "${rightField}"`;
      case '$lte':
        return `"${leftField}" <= "${rightField}"`;
      case '$gt':
        return `"${leftField}" > "${rightField}"`;
      case '$gte':
        return `"${leftField}" >= "${rightField}"`;
      case '$eq':
        return `"${leftField}" = "${rightField}"`;
      case '$ne':
        return `"${leftField}" != "${rightField}"`;
      default:
        throw new QueryTranslationError(`Unsupported $expr operator ${op}`);
    }
  }

  return null;
}

/**
 * Translate a query filter to SQL WHERE clause
 */
export function translateFilter(
  filter: QueryFilter,
  jsonColumns: Set<string> = new Set(),
  arrayColumns: Set<string> = new Set()
): TranslatedQuery {
  if (!filter || Object.keys(filter).length === 0) {
    return { sql: '1', params: [] };
  }

  const clauses: string[] = [];
  const params: unknown[] = [];

  for (const [key, value] of Object.entries(filter)) {
    if (key === '$and' && Array.isArray(value)) {
      // Logical AND
      const subClauses: string[] = [];
      for (const subFilter of value) {
        const translated = translateFilter(subFilter as QueryFilter, jsonColumns, arrayColumns);
        subClauses.push(`(${translated.sql})`);
        params.push(...translated.params);
      }
      if (subClauses.length > 0) {
        clauses.push(`(${subClauses.join(' AND ')})`);
      }
    } else if (key === '$or' && Array.isArray(value)) {
      // Logical OR
      const subClauses: string[] = [];
      for (const subFilter of value) {
        const translated = translateFilter(subFilter as QueryFilter, jsonColumns, arrayColumns);
        subClauses.push(`(${translated.sql})`);
        params.push(...translated.params);
      }
      if (subClauses.length > 0) {
        clauses.push(`(${subClauses.join(' OR ')})`);
      }
    } else if (key === '$not' && typeof value === 'object' && !Array.isArray(value)) {
      // Logical NOT
      const translated = translateFilter(value as QueryFilter, jsonColumns, arrayColumns);
      clauses.push(`NOT (${translated.sql})`);
      params.push(...translated.params);
    } else if (key === '$expr' && typeof value === 'object' && !Array.isArray(value)) {
      // Field-to-field comparison expressions (MongoDB $expr emulation)
      const exprResult = translateExpr(value as Record<string, unknown>);
      if (exprResult) {
        clauses.push(exprResult);
      }
    } else {
      // Regular field filter
      const translated = translateFieldFilter(key, value, jsonColumns, arrayColumns);
      clauses.push(translated.sql);
      params.push(...translated.params);
    }
  }

  return {
    sql: clauses.length > 0 ? clauses.join(' AND ') : '1',
    params,
  };
}

// ============================================================================
// Sort Translation
// ============================================================================

/**
 * Translate sort specification to SQL ORDER BY clause.
 *
 * `columns` is the table's column set. A field that is not one is refused:
 * SQLite reads an unknown double-quoted identifier as a string literal, so
 * the result would come back silently unsorted. Callers that take a sort key
 * from a request validate it against an allowlist first; this is the
 * backstop. Without a column set (pure-shape tests) fields are not checked.
 */
export function translateSort(sort?: SortSpec, columns?: ReadonlySet<string>): string {
  if (!sort || Object.keys(sort).length === 0) {
    return '';
  }

  const orderClauses: string[] = [];

  for (const [field, direction] of Object.entries(sort)) {
    if (columns && !columns.has(field)) {
      throw new QueryTranslationError(`Cannot sort on "${field}": not a column`);
    }
    const dir = direction === 'desc' || direction === -1 ? 'DESC' : 'ASC';
    // Quote the identifier, doubling any embedded quote so it stays one identifier.
    orderClauses.push(`"${field.replace(/"/g, '""')}" ${dir}`);
  }

  return orderClauses.length > 0 ? `ORDER BY ${orderClauses.join(', ')}` : '';
}

// ============================================================================
// Pagination Translation
// ============================================================================

/**
 * Translate pagination options to SQL LIMIT/OFFSET
 */
export function translatePagination(options?: QueryOptions): string {
  const parts: string[] = [];

  if (options?.limit !== undefined && options.limit > 0) {
    parts.push(`LIMIT ${options.limit}`);
  }

  if (options?.skip !== undefined && options.skip > 0) {
    parts.push(`OFFSET ${options.skip}`);
  }

  return parts.join(' ');
}

// ============================================================================
// Update Translation
// ============================================================================

/**
 * Check if an update spec uses operators or is a plain object
 */
function hasUpdateOperators(update: UpdateSpec<unknown>): update is UpdateOperators<unknown> {
  if (typeof update !== 'object' || update === null) {
    return false;
  }

  const keys = Object.keys(update);
  return keys.some(k => k.startsWith('$'));
}

/**
 * Translate an update specification to SQL SET clauses
 */
export function translateUpdate(
  update: UpdateSpec<unknown>,
  jsonColumns: Set<string> = new Set(),
  blobColumns: Set<string> = new Set(),
  compressedColumns: Set<string> = new Set()
): TranslatedUpdate {
  const setClauses: string[] = [];
  const params: unknown[] = [];

  /**
   * Encode a value bound for a compressed column: object/array fields are
   * serialized as JSON first, then the string is handed to the codec, which
   * returns a BLOB or (for short values) the string unchanged.
   */
  const encodeCompressed = (value: unknown): unknown => {
    if (value === null || value === undefined) return null;
    const text = typeof value === 'string' ? value : toJson(value);
    return typeof text === 'string' ? textToBlob(text) : text;
  };

  /** JSON-mutating operators cannot work through the codec. */
  const rejectJsonOperator = (field: string, operator: string) => {
    if (compressedColumns.has(field)) {
      throw new Error(
        `Cannot apply ${operator} to compressed column "${field}": the stored value is a ` +
          `compressed BLOB and SQLite's json_* functions cannot read it. Read, modify and ` +
          `write the whole value instead.`
      );
    }
  };

  if (hasUpdateOperators(update)) {
    // Handle MongoDB-style update operators

    // $set - set fields to values
    if (update.$set) {
      for (const [field, value] of Object.entries(update.$set)) {
        // Handle undefined values - convert to null (SQLite doesn't accept undefined)
        if (value === undefined) {
          setClauses.push(`"${field}" = ?`);
          params.push(null);
        } else if (compressedColumns.has(field)) {
          setClauses.push(`"${field}" = ?`);
          params.push(encodeCompressed(value));
        } else if (blobColumns.has(field) && value instanceof Float32Array) {
          setClauses.push(`"${field}" = ?`);
          params.push(value.length === 0 ? null : embeddingToBlob(value));
        } else if (blobColumns.has(field) && Array.isArray(value)) {
          // BLOB columns: convert number[] to Float32 BLOB
          setClauses.push(`"${field}" = ?`);
          params.push(embeddingToBlob(value as number[]));
        } else if (jsonColumns.has(field) || (typeof value === 'object' && value !== null)) {
          setClauses.push(`"${field}" = ?`);
          params.push(toJson(value));
        } else if (typeof value === 'boolean') {
          setClauses.push(`"${field}" = ?`);
          params.push(value ? 1 : 0);
        } else {
          setClauses.push(`"${field}" = ?`);
          params.push(value);
        }
      }
    }

    // $unset - remove fields (set to null in SQLite)
    if (update.$unset) {
      for (const field of Object.keys(update.$unset)) {
        setClauses.push(`"${field}" = NULL`);
      }
    }

    // $inc - increment numeric fields
    if (update.$inc) {
      for (const [field, amount] of Object.entries(update.$inc)) {
        setClauses.push(`"${field}" = "${field}" + ?`);
        params.push(amount);
      }
    }

    // $push - append to array (JSON column)
    if (update.$push) {
      for (const [field, value] of Object.entries(update.$push)) {
        rejectJsonOperator(field, '$push');
        setClauses.push(`"${field}" = CASE
          WHEN "${field}" IS NULL THEN json_array(?)
          ELSE json_insert("${field}", '$[#]', json(?))
        END`);
        const jsonValue = toJson(value);
        params.push(value, jsonValue);
      }
    }

    // $pull - remove from array (JSON column)
    if (update.$pull) {
      for (const [field, value] of Object.entries(update.$pull)) {
        rejectJsonOperator(field, '$pull');
        setClauses.push(`"${field}" = (SELECT json_group_array(value) FROM json_each("${field}") WHERE value != ?)`);
        params.push(typeof value === 'string' ? value : toJson(value));
      }
    }

    // $addToSet - add unique value to array
    if (update.$addToSet) {
      for (const [field, value] of Object.entries(update.$addToSet)) {
        rejectJsonOperator(field, '$addToSet');
        setClauses.push(`"${field}" = CASE
          WHEN "${field}" IS NULL THEN json_array(?)
          WHEN NOT EXISTS (SELECT 1 FROM json_each("${field}") WHERE value = ?) THEN json_insert("${field}", '$[#]', json(?))
          ELSE "${field}"
        END`);
        const jsonValue = toJson(value);
        params.push(value, value, jsonValue);
      }
    }
  } else {
    // Plain object update - set all fields
    for (const [field, value] of Object.entries(update)) {
      // Skip id and createdAt - these shouldn't be updated
      if (field === 'id' || field === 'createdAt') {
        continue;
      }

      // Handle undefined values - convert to null (SQLite doesn't accept undefined)
      if (value === undefined) {
        setClauses.push(`"${field}" = ?`);
        params.push(null);
      } else if (compressedColumns.has(field)) {
        setClauses.push(`"${field}" = ?`);
        params.push(encodeCompressed(value));
      } else if (blobColumns.has(field) && value instanceof Float32Array) {
        setClauses.push(`"${field}" = ?`);
        params.push(value.length === 0 ? null : embeddingToBlob(value));
      } else if (blobColumns.has(field) && Array.isArray(value)) {
        // BLOB columns: convert number[] to Float32 BLOB
        setClauses.push(`"${field}" = ?`);
        params.push(embeddingToBlob(value as number[]));
      } else if (jsonColumns.has(field) || (typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof Float32Array))) {
        setClauses.push(`"${field}" = ?`);
        params.push(toJson(value));
      } else if (Array.isArray(value)) {
        setClauses.push(`"${field}" = ?`);
        params.push(toJson(value));
      } else if (typeof value === 'boolean') {
        setClauses.push(`"${field}" = ?`);
        params.push(value ? 1 : 0);
      } else {
        setClauses.push(`"${field}" = ?`);
        params.push(value);
      }
    }
  }

  return { setClauses, params };
}

// ============================================================================
// Full Query Building
// ============================================================================

/**
 * Build a complete SELECT query
 */
export function buildSelectQuery(
  table: string,
  filter: QueryFilter,
  options?: QueryOptions,
  jsonColumns?: Set<string>,
  arrayColumns?: Set<string>,
  columns?: ReadonlySet<string>
): TranslatedQuery {
  const whereClause = translateFilter(filter, jsonColumns, arrayColumns);
  const orderBy = translateSort(options?.sort, columns);
  const pagination = translatePagination(options);

  let sql = `SELECT * FROM "${table}" WHERE ${whereClause.sql}`;

  if (orderBy) {
    sql += ' ' + orderBy;
  }

  if (pagination) {
    sql += ' ' + pagination;
  }

  return { sql, params: whereClause.params };
}

/**
 * Build a SELECT COUNT query
 */
export function buildCountQuery(
  table: string,
  filter: QueryFilter,
  jsonColumns?: Set<string>,
  arrayColumns?: Set<string>
): TranslatedQuery {
  const whereClause = translateFilter(filter, jsonColumns, arrayColumns);
  return {
    sql: `SELECT COUNT(*) as count FROM "${table}" WHERE ${whereClause.sql}`,
    params: whereClause.params,
  };
}

/**
 * Build an UPDATE query
 */
export function buildUpdateQuery(
  table: string,
  filter: QueryFilter,
  update: UpdateSpec<unknown>,
  jsonColumns?: Set<string>,
  arrayColumns?: Set<string>,
  blobColumns?: Set<string>,
  compressedColumns?: Set<string>
): TranslatedQuery {
  const whereClause = translateFilter(filter, jsonColumns, arrayColumns);
  const updateClause = translateUpdate(update, jsonColumns, blobColumns, compressedColumns);

  if (updateClause.setClauses.length === 0) {
    throw new Error('Update must specify at least one field to update');
  }

  const sql = `UPDATE "${table}" SET ${updateClause.setClauses.join(', ')} WHERE ${whereClause.sql}`;

  return {
    sql,
    params: [...updateClause.params, ...whereClause.params],
  };
}

/**
 * Build a DELETE query
 */
export function buildDeleteQuery(
  table: string,
  filter: QueryFilter,
  jsonColumns?: Set<string>,
  arrayColumns?: Set<string>
): TranslatedQuery {
  const whereClause = translateFilter(filter, jsonColumns, arrayColumns);

  return {
    sql: `DELETE FROM "${table}" WHERE ${whereClause.sql}`,
    params: whereClause.params,
  };
}
